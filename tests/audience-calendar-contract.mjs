import assert from "node:assert/strict";
import test from "node:test";

import {
  AGE_GROUP_LABELS,
  audienceChipLabel,
  audienceRank,
  orderForAudience,
  seasonForMonth,
  seasonForWeekCode,
} from "../lib/audience-calendar.ts";

// UX-20260830-002: 연령대×계절 큐레이션 계약 — 계절 판정·친화도 순위·안정 정렬·칩 문구.

test("season boundaries map months to seasons", () => {
  assert.equal(seasonForMonth(3), "spring");
  assert.equal(seasonForMonth(5), "spring");
  assert.equal(seasonForMonth(6), "summer");
  assert.equal(seasonForMonth(8), "summer");
  assert.equal(seasonForMonth(9), "autumn");
  assert.equal(seasonForMonth(11), "autumn");
  assert.equal(seasonForMonth(12), "winter");
  assert.equal(seasonForMonth(2), "winter");
});

test("week codes resolve to the season of their Monday", () => {
  assert.equal(seasonForWeekCode("2026-W36"), "summer"); // 8/31 월요일
  assert.equal(seasonForWeekCode("2026-W40"), "autumn"); // 9/27 월요일
  assert.equal(seasonForWeekCode("2026-W01"), "winter"); // 2025-12-29 월요일(ISO 1주차)
});

test("audience rank is 1-based per age group and season, null for unmatched", () => {
  assert.equal(audienceRank("OSA", "20s", "spring"), 1);
  assert.equal(audienceRank("BKK", "20s", "spring"), 5);
  assert.equal(audienceRank("GUM", "40s", "winter"), 3);
  assert.equal(audienceRank("CJU", "20s", "spring"), null);
  assert.equal(audienceRank("DAD", "30s", "autumn"), null);
});

test("audience ordering is stable with unmatched deals keeping relative order", () => {
  const deals = [
    { destination_code: "SIN" },
    { destination_code: "OSA" },
    { destination_code: "BKK" },
    { destination_code: "FUK" },
  ];
  assert.deepEqual(
    orderForAudience(deals, "20s", "spring").map((deal) => deal.destination_code),
    ["OSA", "BKK", "SIN", "FUK"],
  );
  assert.deepEqual(
    orderForAudience(deals, "40s", "autumn").map((deal) => deal.destination_code),
    ["SIN", "OSA", "BKK", "FUK"],
  );
});

test("audience chip label names the age group and season without popularity claims", () => {
  assert.equal(AGE_GROUP_LABELS["30s"], "30대");
  assert.equal(audienceChipLabel("30s", "autumn"), "30대 가을 추천");
  assert.equal(audienceChipLabel("20s", "summer"), "20대 여름 추천");
});
