import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatDurationMinutes } from "../lib/format.ts";
import {
  metroCanonicalOrigin,
  missingTimeFields,
  normalizeOffersForDisplay,
} from "../lib/read-model/offers-display.ts";

// UX-20260910-003: 예약 직전 화면(/offers) 표시 품질 계약 — 프로덕션 실측 3결함
// (SEL↔ICN 이중 노출·원시 float 비행시간·딥링크 없는 카드)의 재발 방어.

function baseOffer(overrides = {}) {
  return {
    offer_id: "o1",
    origin: "ICN",
    origin_label: "ICN",
    traveler: "adt1",
    destination_code: "BKI",
    destination_city: "코타키나발루",
    destination_country: "말레이시아",
    region_code: "SEA",
    region_label: "동남아",
    lat: 3.1,
    lon: 101.7,
    depart_date: "2026-09-13",
    return_date: "2026-09-18",
    stay_nights: 5,
    trip_bucket: "5_7",
    trip_bucket_label: "5~7일",
    airline_code: "AK",
    airline_name: "에어아시아",
    cabin_group: "ECONOMY",
    cabin_label_raw: "Economy",
    fare_family: "Standard",
    price_total: 213431,
    average_30_total: 250000,
    average_90_total: 250000,
    discount_pct_30: 0,
    discount_pct_90: 0,
    price_status: "active",
    is_price_changed: false,
    source_name: "travelpayouts",
    source_id: "travelpayouts",
    source_type: "meta_search",
    stops: 0,
    is_direct: true,
    last_seen_at: "2026-09-10T00:00:00",
    last_batch_at: "2026-09-10T00:00:00",
    deep_link: "https://example.com/book",
    official_promotion: false,
    warning_flags: [],
    badges: [],
    outbound_departure_at: "2026-09-13T19:10:00+09:00",
    outbound_arrival_at: "2026-09-14T00:03:00+09:00",
    inbound_departure_at: "2026-09-18T08:05:00+08:00",
    inbound_arrival_at: "2026-09-18T15:30:00+09:00",
    duration_hours: 4.833333333333333,
    duration_label: formatDurationMinutes(290),
    info_partial: false,
    ...overrides,
  };
}

test("formatDurationMinutes renders human-readable durations, never raw floats", () => {
  assert.equal(formatDurationMinutes(290), "4시간 50분");
  assert.equal(formatDurationMinutes(300), "5시간");
  assert.equal(formatDurationMinutes(0), "시간 미정");
  assert.equal(formatDurationMinutes(Number.NaN), "시간 미정");
});

test("dedup keeps the complete row when SEL and ICN rows carry the same product", () => {
  const selTwin = baseOffer({
    offer_id: "sel",
    origin: "SEL",
    origin_label: "SEL",
    outbound_departure_at: "",
    outbound_arrival_at: "",
    inbound_departure_at: "",
    inbound_arrival_at: "",
    duration_hours: 0,
    duration_label: "시간 미정",
  });
  const result = normalizeOffersForDisplay([selTwin, baseOffer({ offer_id: "icn" })], "ICN");

  assert.equal(result.length, 1, "동일 상품의 SEL 복제행은 dedup된다");
  assert.equal(result[0].offer_id, "icn", "시각·시간을 보유한 행이 대표로 남는다");
  assert.equal(result[0].origin, "ICN");
});

test("SEL-only rows normalize display origin to the queried airport and get demoted when partially missing", () => {
  // 결측 2/5(40% — 과반 미만): 유지하되 배지+하단 격하. 과반(3+) 결측은 아래 제외 테스트가 담당.
  const selOnly = baseOffer({
    offer_id: "sel-only",
    origin: "SEL",
    outbound_arrival_at: "",
    inbound_arrival_at: "",
  });
  const complete = baseOffer({ offer_id: "full", price_total: 300000 });
  const result = normalizeOffersForDisplay([selOnly, complete], "ICN");

  assert.equal(result.length, 2);
  assert.equal(result[0].offer_id, "full", "완전한 행이 결측 행보다 위에 위치한다");
  assert.equal(result[1].origin, "ICN", "SEL 표시 출발지는 조회 공항으로 정규화된다");
  assert.equal(result[1].info_partial, true, "일부 결측 행은 격하 플래그를 받는다");
});

test("offers missing a majority of time fields are excluded outright", () => {
  // 시간정보 5필드(가는/오는 출발·도착+비행시간) 중 3+ 결측 = >50% → 예약 재료로서 제외.
  const mostlyBlind = baseOffer({
    offer_id: "blind",
    origin: "SEL",
    outbound_departure_at: "",
    outbound_arrival_at: "",
    inbound_departure_at: "",
    inbound_arrival_at: "",
    duration_hours: 0,
  });
  assert.equal(missingTimeFields(mostlyBlind), 5);
  const result = normalizeOffersForDisplay([mostlyBlind, baseOffer()], "ICN");
  assert.equal(result.length, 1);
  assert.ok(!result.some((offer) => offer.offer_id === "blind"));
});

test("offers without a booking deeplink never reach the response", () => {
  const linkless = baseOffer({ offer_id: "nolink", deep_link: "" });
  const result = normalizeOffersForDisplay([linkless, baseOffer()], "ICN");
  assert.equal(result.length, 1);
  assert.ok(result.every((offer) => offer.deep_link !== ""));
});

test("metro canonical origin maps SEL to ICN and leaves real airports untouched", () => {
  assert.equal(metroCanonicalOrigin("SEL"), "ICN");
  assert.equal(metroCanonicalOrigin("ICN"), "ICN");
  assert.equal(metroCanonicalOrigin("GMP"), "GMP");
  assert.equal(metroCanonicalOrigin("PUS"), "PUS");
});

test("production fixture: no float strings, no duplicate combos, no SEL rows, no linkless offers", async () => {
  // 2026-09-10 수리 전 프로덕션 응답 고정 샘플 — 결함이 존재하던 상태 그대로를 입력으로 사용한다.
  const fixture = JSON.parse(await readFile(new URL("./fixtures/offers-prod-20260910.json", import.meta.url), "utf8"));
  const rawOffers = fixture.response.data.offers;
  assert.ok(rawOffers.length >= 2, "fixture는 결함 사례를 담아야 한다");
  assert.ok(rawOffers.some((offer) => offer.origin === "SEL"), "fixture 원본에는 SEL행이 있다(수리 전)");
  const dupCombos = new Set(
    rawOffers.map((o) => `${o.depart_date}|${o.return_date}|${o.price_total}|${o.airline_code}`),
  );
  assert.ok(dupCombos.size < rawOffers.length, "fixture 원본에는 동일 (depart,return,price,carrier) 조합이 있다(수리 전)");

  const normalized = normalizeOffersForDisplay(rawOffers, fixture.query.origin);

  // (1) dedup — 동일 조합 2개 이상 존재하지 않음
  const combos = normalized.map((o) => `${o.depart_date}|${o.return_date}|${o.price_total}|${o.airline_code}`);
  assert.equal(new Set(combos).size, combos.length, "dedup 후 동일 (depart,return,price,carrier) 조합은 유일하다");

  // (1) SEL 행 0건
  assert.ok(normalized.every((offer) => offer.origin !== "SEL"), "정규화 후 표시 출발지에 SEL이 없다");

  // (3) 딥링크 없는 오퍼 0건
  assert.ok(normalized.every((offer) => offer.deep_link !== ""));

  // (2) 화면에 도달하는 문자열에 부동소수점 다중 자릿수 패턴이 없음 — ISO 시각 문자열은
  //     formatTime 포맷터를 경유해 렌더되므로 원시 출력 경로가 아니다(스캔에서 제외).
  const floatPattern = /\d+\.\d{3,}/;
  const isoDatetime = /^\d{4}-\d{2}-\d{2}T/;
  for (const offer of normalized) {
    for (const [key, value] of Object.entries(offer)) {
      if (typeof value === "string" && !isoDatetime.test(value)) {
        assert.ok(!floatPattern.test(value), `문자열 필드 ${key}에 원시 float가 남아 있다: ${value}`);
      }
    }
    assert.match(offer.duration_label, /^(?:\d+시간(?: \d+분)?|시간 미정)$/);
  }
});

test("offers page renders duration through the shared label, not the raw float", async () => {
  // 템플릿 회귀 방어 — "{duration_hours}시간" 원시 삽입 경로가 다시 생기지 않는다.
  const page = await readFile(new URL("../app/offers/page.tsx", import.meta.url), "utf8");
  assert.ok(!page.includes("duration_hours}시간"), "원시 float 비행시간 삽입이 존재한다");
  assert.ok(page.includes("{offer.duration_label}"), "공유 포맷터 라벨을 렌더해야 한다");
  assert.ok(page.includes("일부 정보 미확인"), "결측 배지가 렌더 경로에 있어야 한다");
});
