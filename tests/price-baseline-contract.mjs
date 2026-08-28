import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRouteBaseline,
  discountPctFromBaseline,
  mergeDailyHistory,
  minOrNull,
  routeKeyFromDeal,
} from "../scripts/update-price-baselines.mjs";

// RECO-20260828-001: 가격 기준선 계약 — 노선별 일별 최저가 히스토리로부터
// 30일 rolling 평균 대비 절감률을 계산한다. 근거(표본)가 부족하면 주장하지 않는다(null).

test("route key identifies a route bucket uniquely", () => {
  const key = routeKeyFromDeal({
    origin: "ICN",
    destination_city_id: "CJU",
    week: "2026-W36",
    stay_bucket: "3_4",
    traveler: "adt1",
  });
  assert.equal(key, "ICN|CJU|2026-W36|3_4|adt1");
});

test("minOrNull ignores non-numeric values", () => {
  assert.equal(minOrNull([null, undefined, "84210", 90000]), 84210);
  assert.equal(minOrNull([null, undefined]), null);
});

test("mergeDailyHistory upserts today and prunes beyond the window", () => {
  const history = {
    days: {
      "2026-07-01": { "ICN|CJU|2026-W36|3_4|adt1": { economy: 60000, business: null } },
      "2026-08-27": { "ICN|CJU|2026-W36|3_4|adt1": { economy: 90000, business: null } },
    },
  };
  const merged = mergeDailyHistory(history, "2026-08-28", { "ICN|CJU|2026-W36|3_4|adt1": { economy: 84210, business: null } }, 30);
  assert.deepEqual(Object.keys(merged.days).sort(), ["2026-08-27", "2026-08-28"]);
  assert.equal(merged.days["2026-08-28"]["ICN|CJU|2026-W36|3_4|adt1"].economy, 84210);
});

test("baseline averages daily route minimums", () => {
  const baseline = computeRouteBaseline([
    { economy: 100000, business: 200000 },
    { economy: 80000, business: null },
    { economy: 120000, business: 240000 },
  ]);
  assert.equal(baseline.sample_days, 3);
  assert.equal(baseline.avg_economy, 100000);
  assert.equal(baseline.min_economy, 80000);
  assert.equal(baseline.sample_days_business, 2);
  assert.equal(baseline.avg_business, 220000);
});

test("discount requires enough samples and a below-average price", () => {
  const baseline = { sample_days: 3, avg_economy: 100000, min_economy: 80000, sample_days_business: 0, avg_business: null };

  assert.equal(discountPctFromBaseline(75000, baseline), 25);
  assert.equal(discountPctFromBaseline(100000, baseline), null, "평균 이상이면 절감률을 주장하지 않는다");
  const thin = { ...baseline, sample_days: 2 };
  assert.equal(discountPctFromBaseline(75000, thin), null, "표본 부족 시 근거 없는 주장 금지");
});
