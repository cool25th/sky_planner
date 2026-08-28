import assert from "node:assert/strict";
import test from "node:test";

import {
  mapDealFromSql,
  mapOfferFromSql,
  mergeMapDeals,
  parseDealCurrentRow,
  parseOfferJoinRow,
} from "../lib/read-model/row-mappers.ts";

// TEST-20260824-002: "SQL row shape은 zod 경유" 규약을 고정한다.
// node-pg는 NUMERIC을 string, TIMESTAMPTZ를 Date로 반환한다 — 파서가 이를
// 수용하고 매퍼가 도메인 타입(number/string)으로 정규화하는지 계약으로 검증.

function pgDealRow(overrides = {}) {
  return {
    origin: "ICN",
    destination_city_id: "TYO",
    destination_display_name: "도쿄",
    country_code: "JP",
    region: "ASIA",
    latitude: null,
    longitude: null,
    economy_min_total_krw: "382500",
    economy_discount_pct: "12.5",
    economy_badge_type: "hot_deal",
    economy_price_status: "active",
    economy_representative_airline: "KE",
    economy_representative_source: "korean_air_official",
    economy_deep_link: "https://example.com/booking",
    economy_last_seen_at: null,
    economy_last_batch_at: null,
    business_min_total_krw: null,
    business_discount_pct: null,
    business_badge_type: null,
    business_price_status: null,
    business_representative_airline: null,
    business_representative_source: null,
    business_deep_link: null,
    business_last_seen_at: null,
    business_last_batch_at: null,
    warning_flags: ["price_spike"],
    enabled_sources: ["skyscanner_affiliate", "korean_air_official"],
    ...overrides,
  };
}

test("parseDealCurrentRow accepts node-pg shapes (NUMERIC string, Date timestamp, text[])", () => {
  const row = parseDealCurrentRow(pgDealRow({ economy_last_batch_at: new Date("2026-08-27T18:57:10Z") }));
  assert.equal(row.economy_min_total_krw, "382500");
  assert.ok(row.economy_last_batch_at instanceof Date);
  assert.deepEqual(row.warning_flags, ["price_spike"]);
});

test("parseDealCurrentRow rejects rows outside the zod contract", () => {
  assert.throws(() => parseDealCurrentRow(pgDealRow({ economy_min_total_krw: { amount: 1 } })));
  assert.throws(() => parseDealCurrentRow(pgDealRow({ warning_flags: "not-an-array" })));
  assert.throws(() => parseDealCurrentRow(pgDealRow({ latitude: "37.5" })));
});

test("mapDealFromSql coerces string numerics, fills fallbacks, keeps origin per cabin", () => {
  const deal = mapDealFromSql(parseDealCurrentRow(pgDealRow()), "2026-08-27T03:56");
  assert.equal(deal.economy_min_total, 382500);
  assert.equal(deal.economy_discount_pct, 12.5);
  assert.equal(deal.business_min_total, null);
  assert.equal(deal.lat, 37.5665);
  assert.equal(deal.lon, 126.978);
  assert.equal(deal.last_batch_at, "2026-08-27T03:56");
  assert.equal(deal.last_seen_at, "2026-08-27T03:56");
  assert.equal(deal.best_origin_by_cabin.ECONOMY, "ICN");
  assert.equal(deal.best_origin_by_cabin.BUSINESS, null);
  assert.deepEqual(deal.promotion_tags, ["hot_deal"]);
  assert.deepEqual(deal.source_mix, ["skyscanner_affiliate", "korean_air_official"]);
});

function pgOfferRow(overrides = {}) {
  return {
    offer_id: "offer-1",
    origin_airport: "ICN",
    destination_airport: "NRT",
    destination_city_id: "TYO",
    traveler: "adt1",
    stay_bucket: "5_7",
    depart_date: "2026-09-04",
    return_date: "2026-09-08",
    stay_nights: "4",
    airline_code: "KE",
    airline_name: null,
    booking_source: "korean_air_official",
    source_id: "korean_air_official",
    source_type: "airline_official",
    cabin_group: "ECONOMY",
    cabin_label_raw: "이코노미",
    fare_brand_raw: "Flex",
    total_price: null,
    normalized_total_krw: "421000",
    average_30_total: null,
    average_90_total: null,
    discount_pct_30: "8",
    discount_pct_90: null,
    price_status: "active",
    is_price_changed: null,
    stop_count: "0",
    departure_time_local: "09:20",
    arrival_time_local: "11:40",
    return_departure_time_local: null,
    return_arrival_time_local: null,
    duration_minutes: "540",
    duration_hours: null,
    deep_link: "https://example.com/offer",
    official_promotion: null,
    warning_flags: null,
    badges: ["cheapest"],
    last_seen_at: null,
    last_batch_at: null,
    dest_latitude: null,
    dest_longitude: null,
    dest_display_name_ko: "도쿄",
    dest_country_code: "JP",
    dest_region: "ASIA",
    ...overrides,
  };
}

test("parseOfferJoinRow accepts node-pg shapes and mapOfferFromSql normalizes them", () => {
  const row = parseOfferJoinRow(pgOfferRow());
  assert.equal(row.normalized_total_krw, "421000");

  const offer = mapOfferFromSql(row, "2026-08-27T03:56");
  assert.equal(offer.price_total, 421000);
  assert.equal(offer.average_30_total, 421000);
  assert.equal(offer.depart_date, "2026-09-04");
  assert.equal(offer.stops, 0);
  assert.equal(offer.is_direct, true);
  assert.equal(offer.duration_hours, 9);
  assert.equal(offer.price_status, "active");
  assert.equal(offer.last_seen_at, "2026-08-27T03:56");
  assert.ok(offer.airline_name.length > 0);
  assert.deepEqual(offer.warning_flags, []);
  assert.deepEqual(offer.badges, ["cheapest"]);
});

test("mapOfferFromSql prefers total_price over normalized fallback", () => {
  const offer = mapOfferFromSql(parseOfferJoinRow(pgOfferRow({ total_price: "399000" })), "fallback");
  assert.equal(offer.price_total, 399000);
});

test("mergeMapDeals picks cheapest per cabin and latest batch stamp", () => {
  const icnDeal = mapDealFromSql(
    parseDealCurrentRow(pgDealRow({ economy_last_batch_at: "2026-08-26T18:57" })),
    "fallback",
  );
  const pusDeal = mapDealFromSql(
    parseDealCurrentRow(
      pgDealRow({
        origin: "PUS",
        economy_min_total_krw: "402000",
        economy_last_batch_at: "2026-08-27T18:57",
        business_min_total_krw: "890000",
        business_last_batch_at: "2026-08-27T18:57",
      }),
    ),
    "fallback",
  );

  const merged = mergeMapDeals([icnDeal, pusDeal]);
  assert.equal(merged.economy_min_total, 382500);
  assert.equal(merged.business_min_total, 890000);
  assert.equal(merged.best_origin_by_cabin.ECONOMY, "ICN");
  assert.equal(merged.best_origin_by_cabin.BUSINESS, "PUS");
  assert.equal(merged.last_batch_at, "2026-08-27T18:57");
});
