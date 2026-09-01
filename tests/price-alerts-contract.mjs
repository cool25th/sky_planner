import assert from "node:assert/strict";
import test from "node:test";

import {
  dealPriceLookup,
  evaluatePriceAlerts,
  parseStoredPriceAlerts,
  priceAlertsStorageKey,
} from "../lib/price-alerts.ts";

// UX-20260831-006 MVP(재방문 비교): localStorage 알림 ↔ 현재 최저가 비교의 순수 로직 계약.
// 저장은 PriceAlertModal이, 비교·조회는 이 모듈이 담당한다(발송 인프라는 A3 전까지 없음).

const baseAlert = {
  id: "FUK_1",
  destinationCode: "FUK",
  cityName: "후쿠오카",
  origin: "ICN",
  targetPrice: 150000,
};

test("parseStoredPriceAlerts accepts valid records and filters malformed ones", () => {
  const raw = JSON.stringify([
    baseAlert,
    { id: "x", destinationCode: "", cityName: "깨진", origin: "ICN", targetPrice: 100 },
    "not-an-object",
    { ...baseAlert, id: "NEG", targetPrice: -1 },
  ]);
  const alerts = parseStoredPriceAlerts(raw);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "FUK_1");

  assert.deepEqual(parseStoredPriceAlerts(null), []);
  assert.deepEqual(parseStoredPriceAlerts("not json"), []);
  assert.deepEqual(parseStoredPriceAlerts(JSON.stringify({ no: "array" })), []);
});

test("evaluatePriceAlerts marks reached at or below target and pending otherwise", () => {
  const alerts = [
    { ...baseAlert, id: "hit", targetPrice: 150000 },
    { ...baseAlert, id: "exact", targetPrice: 146960 },
    { ...baseAlert, id: "miss", targetPrice: 100000 },
  ];
  const priceFor = () => 146960;
  const { reached, pending } = evaluatePriceAlerts(alerts, priceFor);
  // 경계(목표 == 현재가)는 도달로 본다 — "이하로 내려가면"이 약속이다.
  assert.deepEqual(reached.map((item) => item.alert.id).sort(), ["exact", "hit"]);
  assert.deepEqual(pending.map((item) => item.alert.id), ["miss"]);
  assert.equal(pending[0].currentPrice, 146960);
});

test("dealPriceLookup maps destination and cabin to the matching price column", () => {
  const lookup = dealPriceLookup([
    { destination_code: "FUK", economy_min_total: 146960, business_min_total: 420000 },
    { destination_code: "BKK", economy_min_total: null, business_min_total: null },
    { destination_code: "TYO", economy_min_total: 200000, business_min_total: null },
  ]);
  assert.equal(lookup({ ...baseAlert }), 146960);
  assert.equal(lookup({ ...baseAlert, cabin: "BUSINESS" }), 420000);
  assert.equal(lookup({ ...baseAlert, destinationCode: "BKK" }), null, "가격 없는 딜은 미확인(보류)");
  assert.equal(lookup({ ...baseAlert, destinationCode: "XXX" }), null, "미수집 목적지는 보류");
  assert.equal(lookup({ ...baseAlert, destinationCode: "TYO", cabin: "BUSINESS" }), null, "비즈니스 결측도 보류");

  const { reached, pending } = evaluatePriceAlerts(
    [
      { ...baseAlert, destinationCode: "BKK", targetPrice: 300000 },
      { ...baseAlert, destinationCode: "FUK", targetPrice: 300000 },
    ],
    lookup,
  );
  assert.equal(reached.length, 1);
  assert.equal(pending.length, 1, "가격을 못 찾은 알림은 도달로 오판하지 않는다");
});

test("storage key stays stable across visits", () => {
  assert.equal(priceAlertsStorageKey(), "sky_planner_price_alerts");
});
