import assert from "node:assert/strict";
import test from "node:test";

import { formatCompactDate, formatMoney } from "../lib/format.ts";
import { PRICE_DEFINITION_SHORT } from "../lib/price-definition.ts";
import {
  buildDateLine,
  buildTripBadges,
  selectLowestPriceDeals,
  toTripCardModel,
} from "../lib/trip-card.ts";

function deal(overrides = {}) {
  return {
    destination_code: "TYO",
    city: "도쿄",
    country: "일본",
    region_label: "일본",
    economy_min_total: 238000,
    business_min_total: 512000,
    economy_discount_pct: 18,
    business_discount_pct: 6,
    economy_best_depart_date: "2026-09-16",
    economy_best_return_date: "2026-09-20",
    best_origin_by_cabin: { ECONOMY: "GMP", BUSINESS: "ICN" },
    ...overrides,
  };
}

const query = {
  origin: "ICN",
  week: "2026-W38",
  stay_bucket: "5_7",
  traveler: "adt1",
  cabin: "ALL",
};

test("date line uses best dates and night count when present", () => {
  assert.equal(
    buildDateLine(deal(), "5_7"),
    `${formatCompactDate("2026-09-16")} → ${formatCompactDate("2026-09-20")} · 4박`,
  );
});

test("date line falls back to stay bucket when best dates are missing", () => {
  assert.equal(
    buildDateLine(deal({ economy_best_depart_date: null, economy_best_return_date: null }), "3_4"),
    "이 주간 · 3–4일 일정 최저",
  );
});

test("badges encode discount, weekend, and holiday without inventing claims", () => {
  const badges = buildTripBadges(deal());
  assert.deepEqual(
    badges.map((badge) => badge.label),
    ["특가", "주말"],
  );

  const holidayBadges = buildTripBadges(
    deal({
      economy_discount_pct: 4,
      economy_best_depart_date: "2026-09-24",
      economy_best_return_date: "2026-09-26",
    }),
  );
  assert.deepEqual(
    holidayBadges.map((badge) => badge.label),
    ["주말", "연휴"],
  );

  const labels = [...badges, ...holidayBadges].map((badge) => badge.label).join(" ");
  assert.equal(/직항|수하물포함|수하물 포함/.test(labels), false);
});

test("model always discloses 1인 and unknown baggage", () => {
  const model = toTripCardModel(deal(), query, ["30일 평균 대비 18% 저렴"]);
  assert.equal(model.definition, PRICE_DEFINITION_SHORT);
  assert.match(model.definition, /성인 1인/);
  assert.match(model.definition, /수하물 미확인/);
  assert.equal(model.priceLabel, formatMoney(238000));
  assert.equal(model.priceAvailable, true);
  assert.equal(model.originHint, null);
  assert.equal(model.reasons[0], "30일 평균 대비 18% 저렴");
  assert.equal(
    model.href,
    "/destination/TYO?origin=ICN&week=2026-W38&stay_bucket=5_7&traveler=adt1&cabin=ALL",
  );
});

test("SEL origin hint uses best airport without changing the fare", () => {
  const model = toTripCardModel(deal(), { ...query, origin: "SEL" });
  assert.equal(model.originHint, "김포 출발 최저");
  assert.equal(model.priceLabel, formatMoney(238000));
});

test("missing price disables the destination link", () => {
  const model = toTripCardModel(
    deal({ economy_min_total: null, economy_discount_pct: null }),
    query,
  );
  assert.equal(model.priceAvailable, false);
  assert.equal(model.priceLabel, "-");
});

test("lowest-price strip orders by economy fare ascending, skips unknown prices, caps length", () => {
  const picked = selectLowestPriceDeals(
    [
      deal({ destination_code: "BKK", economy_min_total: 320000 }),
      deal({ destination_code: "CJU", economy_min_total: 84000 }),
      deal({ destination_code: "OSA", economy_min_total: null }),
      deal({ destination_code: "TYO", economy_min_total: 146000 }),
      deal({ destination_code: "HKG", economy_min_total: 210000 }),
    ],
    2,
  );
  assert.deepEqual(
    picked.map((row) => row.destination_code),
    ["CJU", "TYO"],
  );
});
