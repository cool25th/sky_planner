import assert from "node:assert/strict";
import test from "node:test";

import { resolveMapResponseWithBookableWeek } from "../lib/map-week-fallback.ts";

// UX-20260830-003: 기본 주간 특가 소진 시 다음 주 자동 진행 계약 —
// 명시 week 존중·다음 주도 비어 있으면 원복·서비스 장앰는 자동 진행 제외.

function responseWithDeals(week, dealCount, diagnostics = { data_mode: "live" }) {
  return {
    data: { deals: Array.from({ length: dealCount }, (_, i) => ({ destination_code: `D${i}`, week }) ) },
    diagnostics,
    last_batch_at: "2026-08-30T00:00:00Z",
  };
}

function stubResolver(dealCountsByWeek, diagnosticsByWeek = {}) {
  return async (query) => responseWithDeals(query.week, dealCountsByWeek[query.week] ?? 0, diagnosticsByWeek[query.week]);
}

test("advances to the next week when the default week is sold out", async () => {
  const result = await resolveMapResponseWithBookableWeek(
    { origin: "ICN", week: "2026-W35", region: "ALL", cabin: "ALL", stay_bucket: "5_7", traveler: "adt1", airlines: [], budget: null },
    { explicitWeek: false, nextWeek: "2026-W36", resolve: stubResolver({ "2026-W35": 0, "2026-W36": 13 }) },
  );
  assert.equal(result.week, "2026-W36");
  assert.equal(result.weekAdvancedFrom, "2026-W35");
  assert.equal(result.response.data.deals.length, 13);
});

test("keeps the current week when it still has deals", async () => {
  const result = await resolveMapResponseWithBookableWeek(
    { origin: "ICN", week: "2026-W35", region: "ALL", cabin: "ALL", stay_bucket: "5_7", traveler: "adt1", airlines: [], budget: null },
    { explicitWeek: false, nextWeek: "2026-W36", resolve: stubResolver({ "2026-W35": 5 }) },
  );
  assert.equal(result.week, "2026-W35");
  assert.equal(result.weekAdvancedFrom, null);
});

test("respects an explicitly selected week even when it is empty", async () => {
  const result = await resolveMapResponseWithBookableWeek(
    { origin: "ICN", week: "2026-W35", region: "ALL", cabin: "ALL", stay_bucket: "5_7", traveler: "adt1", airlines: [], budget: null },
    { explicitWeek: true, nextWeek: "2026-W36", resolve: stubResolver({ "2026-W35": 0, "2026-W36": 13 }) },
  );
  assert.equal(result.week, "2026-W35");
  assert.equal(result.weekAdvancedFrom, null);
  assert.equal(result.response.data.deals.length, 0);
});

test("keeps the empty current week when the next week is empty too", async () => {
  const result = await resolveMapResponseWithBookableWeek(
    { origin: "ICN", week: "2026-W35", region: "ALL", cabin: "ALL", stay_bucket: "5_7", traveler: "adt1", airlines: [], budget: null },
    { explicitWeek: false, nextWeek: "2026-W36", resolve: stubResolver({ "2026-W35": 0, "2026-W36": 0 }) },
  );
  assert.equal(result.week, "2026-W35");
  assert.equal(result.weekAdvancedFrom, null);
});

test("never advances on service-unavailable responses", async () => {
  const result = await resolveMapResponseWithBookableWeek(
    { origin: "ICN", week: "2026-W35", region: "ALL", cabin: "ALL", stay_bucket: "5_7", traveler: "adt1", airlines: [], budget: null },
    {
      explicitWeek: false,
      nextWeek: "2026-W36",
      resolve: stubResolver({ "2026-W35": 0 }, { "2026-W35": { service_unavailable: true } }),
    },
  );
  assert.equal(result.week, "2026-W35");
  assert.equal(result.weekAdvancedFrom, null);
});
