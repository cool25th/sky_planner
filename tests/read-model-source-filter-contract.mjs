import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarDataFromOffers,
  eligibleReadModelSourceKeys,
  filterMapDealForSourceFlags,
  readModelSourceKeyIsEligible,
} from "../lib/read-model-source-filter.ts";

function mapDeal(overrides = {}) {
  return {
    destination_code: "TYO",
    city: "도쿄",
    country: "JP",
    region_code: "JP",
    region_label: "일본",
    lat: 35.6762,
    lon: 139.6503,
    economy_min_total: 220000,
    business_min_total: 880000,
    economy_discount_pct: 12,
    business_discount_pct: 8,
    economy_price_status: "active",
    business_price_status: "active",
    best_airline_by_cabin: { ECONOMY: "KE", BUSINESS: "OZ" },
    representative_links: { ECONOMY: "https://www.koreanair.com", BUSINESS: "https://flyasiana.com" },
    last_batch_at: "2026-05-25T04:00",
    last_seen_at: "2026-05-25T04:00",
    warning_flags: [],
    promotion_tags: [],
    source_mix: ["ke", "oz"],
    ...overrides,
  };
}

function offer(overrides = {}) {
  return {
    offer_id: "offer-1",
    origin: "ICN",
    origin_label: "인천",
    traveler: "adt1",
    destination_code: "TYO",
    destination_city: "도쿄",
    destination_country: "JP",
    region_code: "JP",
    region_label: "일본",
    lat: 35.6762,
    lon: 139.6503,
    depart_date: "2026-03-24",
    return_date: "2026-03-31",
    stay_nights: 7,
    trip_bucket: "5_7",
    trip_bucket_label: "5-7일",
    airline_code: "KE",
    airline_name: "대한항공",
    cabin_group: "ECONOMY",
    cabin_label_raw: "Economy",
    fare_family: "Standard",
    price_total: 250000,
    average_30_total: 280000,
    average_90_total: 300000,
    discount_pct_30: 10,
    discount_pct_90: 17,
    price_status: "active",
    is_price_changed: false,
    source_name: "대한항공",
    source_id: "ke",
    source_type: "airline_official",
    stops: 0,
    is_direct: true,
    last_seen_at: "2026-05-25T04:00",
    last_batch_at: "2026-05-25T04:00",
    deep_link: "https://www.koreanair.com",
    official_promotion: false,
    warning_flags: [],
    badges: ["가격 특가"],
    outbound_departure_at: "09:00",
    outbound_arrival_at: "11:00",
    inbound_departure_at: "12:00",
    inbound_arrival_at: "14:00",
    duration_hours: 2,
    ...overrides,
  };
}

test("read model source keys include booking-source aliases", () => {
  const keys = eligibleReadModelSourceKeys(["korean_air_official"]);

  assert.equal(readModelSourceKeyIsEligible("korean_air_official", keys), true);
  assert.equal(readModelSourceKeyIsEligible("KE", keys), true);
  assert.equal(readModelSourceKeyIsEligible("oz", keys), false);
});

test("map deals hide only cabins represented by unhealthy sources", () => {
  const filtered = filterMapDealForSourceFlags(mapDeal(), {
    economy_representative_source: "ke",
    business_representative_source: "oz",
  }, ["korean_air_official"]);

  assert.ok(filtered);
  assert.equal(filtered.economy_min_total, 220000);
  assert.equal(filtered.representative_links.ECONOMY, "https://www.koreanair.com");
  assert.equal(filtered.business_min_total, null);
  assert.equal(filtered.representative_links.BUSINESS, null);
  assert.deepEqual(filtered.source_mix, ["ke"]);
});

test("map deals disappear when no represented cabin belongs to an eligible source", () => {
  const filtered = filterMapDealForSourceFlags(mapDeal(), {
    economy_representative_source: "ke",
    business_representative_source: "oz",
  }, ["skyscanner_affiliate"]);

  assert.equal(filtered, null);
});

test("calendar read model can be rebuilt from source-filtered offers", () => {
  const query = {
    origin: "ICN",
    week: "2026-W13",
    destination: "TYO",
    cabin: "ALL",
    stay_bucket: "5_7",
    traveler: "adt1",
    airlines: [],
  };
  const calendar = buildCalendarDataFromOffers(query, {
    code: "TYO",
    city: "도쿄",
    country: "JP",
    region_code: "JP",
    region_label: "일본",
    lat: 35.6762,
    lon: 139.6503,
  }, [
    offer({ offer_id: "eco-expensive", price_total: 260000 }),
    offer({ offer_id: "eco-cheap", price_total: 240000, airline_code: "KE" }),
    offer({ offer_id: "biz", cabin_group: "BUSINESS", price_total: 900000, airline_code: "OZ", airline_name: "아시아나항공" }),
  ]);

  assert.equal(calendar.destination?.code, "TYO");
  assert.deepEqual(calendar.departure_dates, ["2026-03-24"]);
  assert.deepEqual(calendar.return_dates, ["2026-03-31"]);
  assert.equal(calendar.cells[0].economy_min_total, 240000);
  assert.equal(calendar.cells[0].business_min_total, 900000);
  assert.equal(calendar.cells[0].best_offer_ids.ECONOMY, "eco-cheap");
  assert.deepEqual(calendar.available_airlines.map((item) => item.code), ["KE", "OZ"]);
});
