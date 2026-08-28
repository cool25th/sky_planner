import assert from "node:assert/strict";
import test from "node:test";

import {
  curateFeaturedDeals,
  daysUntilDeparture,
  scoreDealForCuration,
  stayIncludesWeekend,
} from "../lib/recommendation.ts";

// RECO-20260828-002: 추천 규칙 엔진 계약 — 점수는 규칙의 합이고 근거는 문장으로 남는다.
// 표본 부족(discount null)이면 가격 주장을 하지 않는다.

const TODAY = "2026-08-28";

function deal(overrides = {}) {
  return {
    destination_code: "TYO",
    economy_min_total: 300000,
    economy_discount_pct: null,
    economy_best_depart_date: null,
    economy_best_return_date: null,
    ...overrides,
  };
}

test("daysUntilDeparture counts calendar days and rejects invalid input", () => {
  assert.equal(daysUntilDeparture("2026-09-16", TODAY), 19);
  assert.equal(daysUntilDeparture("2026-08-28", TODAY), 0);
  assert.equal(daysUntilDeparture(null, TODAY), null);
  assert.equal(daysUntilDeparture("not-a-date", TODAY), null);
});

test("stayIncludesWeekend detects weekend nights in the stay window", () => {
  // 2026-08-31(월) ~ 2026-09-04(금): 주중만
  assert.equal(stayIncludesWeekend("2026-08-31", "2026-09-04"), false);
  // 2026-09-05(토) 포함
  assert.equal(stayIncludesWeekend("2026-09-03", "2026-09-06"), true);
  assert.equal(stayIncludesWeekend(null, "2026-09-06"), false);
});

test("scoring combines price, timing, and weekend merits with reasons", () => {
  const scored = scoreDealForCuration(
    deal({
      economy_discount_pct: 18,
      economy_best_depart_date: "2026-09-16",
      economy_best_return_date: "2026-09-20",
    }),
    TODAY,
  );
  assert.equal(scored.score, 40 + 30 + 10);
  assert.deepEqual(scored.reasons, ["30일 평균 대비 18% 저렴", "출발 D-19 · 예약 적기", "주말 포함"]);
});

test("no price claim without baseline-backed discount", () => {
  const scored = scoreDealForCuration(
    deal({ economy_best_depart_date: "2026-09-16" }),
    TODAY,
  );
  assert.equal(scored.score, 30);
  assert.deepEqual(scored.reasons, ["출발 D-19 · 예약 적기"]);
});

test("curation ranks by score then cheaper price", () => {
  const curated = curateFeaturedDeals(
    [
      deal({ destination_code: "FAR", economy_min_total: 900000, economy_best_depart_date: "2026-11-30" }),
      deal({ destination_code: "CHEAP", economy_min_total: 100000, economy_best_depart_date: "2026-09-10" }),
      deal({ destination_code: "BEST", economy_min_total: 400000, economy_best_depart_date: "2026-09-20", economy_discount_pct: 25 }),
    ],
    TODAY,
    2,
  );
  assert.deepEqual(curated.map((entry) => entry.deal.destination_code), ["BEST", "CHEAP"]);
  assert.ok(curated[0].reasons.length >= 2);
});

test("departures in the past or far future score low without timing reasons", () => {
  const past = scoreDealForCuration(deal({ economy_best_depart_date: "2026-08-20" }), TODAY);
  assert.equal(past.score, 0);
  assert.deepEqual(past.reasons, []);
  const far = scoreDealForCuration(deal({ economy_best_depart_date: "2026-12-25" }), TODAY);
  assert.equal(far.score, 5);
});
