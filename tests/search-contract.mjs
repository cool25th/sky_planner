import assert from "node:assert/strict";
import test from "node:test";

import {
  findDestinationMatches,
  getSearchResults,
  parseSearchQuery,
} from "../lib/mock-market.ts";
import {
  filterHealthySourceFlags,
  isOfferSourceEligible,
  sourceHealthBlockReason,
} from "../lib/source-policy.ts";

const DEFAULT_SOURCE_FLAGS = [
  "skyscanner_affiliate",
  "korean_air_official",
  "asiana_official",
];

test("free-text destination search resolves aliases and ranks a best fare", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "Tokyo",
    days: "7",
    flex: "1",
    cabin: "ALL",
  });
  const result = getSearchResults(query);

  assert.equal(query.destination, "TYO");
  assert.equal(result.destination?.code, "TYO");
  assert.equal(result.search_scope.kind, "exact");
  assert.deepEqual(result.search_scope.destination_codes, ["TYO"]);
  assert.ok(result.total_offers > 0);
  assert.ok(result.best_offer);
  assert.equal(result.lowest_price, result.best_offer.price_total);
  assert.ok(result.offers.every((offer) => offer.stay_nights >= 6 && offer.stay_nights <= 8));
  assert.ok(result.offers.every((offer) => offer.price_status !== "sold_out"));
  assert.ok(result.offers.every((offer) => isOfferSourceEligible(offer, DEFAULT_SOURCE_FLAGS)));
});

test("country-level destination search compares all matching cities", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "일본",
    days: "7",
    flex: "1",
    cabin: "ALL",
  });
  const result = getSearchResults(query);
  const searchedCodes = new Set(result.search_scope.destination_codes);
  const offeredCodes = new Set(result.offers.map((offer) => offer.destination_code));

  assert.equal(result.search_scope.kind, "broad");
  assert.ok(searchedCodes.has("FUK"));
  assert.ok(searchedCodes.has("TYO"));
  assert.ok(offeredCodes.has("FUK"));
  assert.ok(offeredCodes.has("TYO"));
  assert.equal(result.destination?.code, result.best_offer?.destination_code);
  assert.equal(result.destination?.code, "FUK");
  assert.equal(result.lowest_price, result.best_offer?.price_total);
  assert.ok(result.quality_summary.destinations >= 2);
});

test("source flags exclude disabled booking sources from search ranking", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "FUK",
    days: "7",
    flex: "1",
    cabin: "ALL",
  });
  const result = getSearchResults(query, "2026-03-24T02:00", ["korean_air_official"]);

  assert.equal(result.destination?.code, "FUK");
  assert.ok(result.total_offers > 0);
  assert.ok(result.offers.every((offer) => offer.source_id === "ke"));
  assert.ok(result.offers.every((offer) => isOfferSourceEligible(offer, ["korean_air_official"])));
});

test("source health blocks stale or unhealthy sources", () => {
  const now = new Date("2026-05-24T12:00:00Z");
  const healthy = {
    source_id: "skyscanner_affiliate",
    enabled_by_flag: true,
    last_success_at: "2026-05-24T11:30:00Z",
  };
  const stale = {
    source_id: "korean_air_official",
    enabled_by_flag: true,
    last_success_at: "2026-05-22T11:30:00Z",
  };
  const circuitOpen = {
    source_id: "asiana_official",
    enabled_by_flag: true,
    circuit_breaker_open: true,
    last_success_at: "2026-05-24T11:30:00Z",
  };

  assert.equal(sourceHealthBlockReason(healthy, now, 24), null);
  assert.equal(sourceHealthBlockReason(stale, now, 24), "stale");
  assert.equal(sourceHealthBlockReason(circuitOpen, now, 24), "circuit_breaker_open");
  assert.deepEqual(
    filterHealthySourceFlags(DEFAULT_SOURCE_FLAGS, [healthy, stale, circuitOpen], now, 24),
    ["skyscanner_affiliate"],
  );
});

test("search returns no bookable offers when every source is disabled", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "Tokyo",
    days: "7",
    flex: "1",
    cabin: "ALL",
  });
  const result = getSearchResults(query, "2026-03-24T02:00", []);

  assert.equal(result.destination?.code, "TYO");
  assert.equal(result.total_offers, 0);
  assert.equal(result.lowest_price, null);
  assert.deepEqual(result.offers, []);
});

test("business cabin search excludes economy offers and preserves cabin summary", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "LAX",
    days: "7",
    flex: "0",
    cabin: "BUSINESS",
  });
  const result = getSearchResults(query);
  const businessSummary = result.price_by_cabin.find((summary) => summary.cabin === "BUSINESS");
  const economySummary = result.price_by_cabin.find((summary) => summary.cabin === "ECONOMY");

  assert.equal(result.destination?.code, "LAX");
  assert.ok(result.total_offers > 0);
  assert.ok(result.offers.every((offer) => offer.cabin_group === "BUSINESS"));
  assert.ok(businessSummary);
  assert.ok((businessSummary?.offer_count ?? 0) > 0);
  assert.equal(economySummary?.offer_count, 0);
});

test("unknown destination returns a stable empty result", () => {
  const query = parseSearchQuery({
    origin: "ICN",
    q: "Atlantis",
    days: "7",
    flex: "1",
  });
  const result = getSearchResults(query);

  assert.equal(query.destination, "");
  assert.equal(result.destination, null);
  assert.deepEqual(findDestinationMatches("Atlantis"), []);
  assert.equal(result.total_offers, 0);
  assert.deepEqual(result.offers, []);
});

// DATA-20260828-001 완화(2026-09-01 승인): 스케줄 지연(관측 최대 8h15m)이 24h 마감을 넘기면
// 실운임을 버리고 목 데이터로 갈아끼우던 것을 막는다 — 기본 임계 48h는 하루 종일 드랍이 아니면
// 넘지 않는 여유. 정책 변경은 의도적인 결정이므로 계약으로 고정한다(env SOURCE_MAX_STALE_HOURS가 우선).
test("default stale budget tolerates a full day of scheduler drift", async () => {
  const { sourceMaxStaleHoursFromEnv } = await import("../lib/source-policy.ts");
  assert.equal(sourceMaxStaleHoursFromEnv({}), 48);
  assert.equal(sourceMaxStaleHoursFromEnv({ SOURCE_MAX_STALE_HOURS: "24" }), 24, "env가 우선한다");
});
