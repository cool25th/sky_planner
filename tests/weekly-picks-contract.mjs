import assert from "node:assert/strict";
import test from "node:test";

import { trackingSubId, withAffiliateTracking } from "../lib/affiliate-link.ts";
import {
  buildWeeklyPick,
  curateWeeklyPicks,
  scoreDealForCuration,
  weeklyPickPersona,
  weeklyPickSections,
} from "../lib/recommendation.ts";

// 완료정의[4]: 근거 4필드(페르소나·출발 창·왜 싼지·관측 시각) 없는 픽은 홈 주간 픽에 들지 않는다.

const TODAY = "2026-09-08"; // 화요일(UTC)

function pickableDeal(overrides = {}) {
  return {
    destination_code: "FUK",
    economy_min_total: 163450,
    economy_discount_pct: 18,
    economy_best_depart_date: "2026-09-16", // 수요일, D+8 — 주말치기 아님
    economy_best_return_date: "2026-09-18",
    last_seen_at: "2026-09-07T20:22",
    ...overrides,
  };
}

test("a pick requires all four evidenced fields", () => {
  const base = pickableDeal();

  // 관측 시각 없음 → 픽 불가
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, last_seen_at: null }, TODAY), TODAY), null);
  // 절감 근거 없음(평균 데이터 <5%) → 픽 불가
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, economy_discount_pct: 3 }, TODAY), TODAY), null);
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, economy_discount_pct: null }, TODAY), TODAY), null);
  // 가격 없음 → 픽 불가
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, economy_min_total: null }, TODAY), TODAY), null);
  // 출발 창 없음 → 픽 불가
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, economy_best_depart_date: null }, TODAY), TODAY), null);
  // 과거 출발 → 픽 불가
  assert.equal(buildWeeklyPick(scoreDealForCuration({ ...base, economy_best_depart_date: "2026-09-01" }, TODAY), TODAY), null);

  const pick = buildWeeklyPick(scoreDealForCuration(base, TODAY), TODAY);
  assert.ok(pick, "4필드가 갖춰지면 픽이 된다");
  assert.equal(pick.persona.id, "deal_hunter", "화–목 출발·D+17 미만·절감 18%는 딜헌터");
  assert.equal(pick.whyCheap, "30일 평균 대비 18% 저렴");
  assert.equal(pick.observedAt, "2026-09-07T20:22");
  assert.deepEqual(pick.departWindow, { depart: "2026-09-16", ret: "2026-09-18", daysUntil: 8 });
});

test("persona mapping follows the landing sections", () => {
  // 금–월 출발 + 주말 포함 = 주말치기 (2026-09-11 금)
  assert.equal(weeklyPickPersona(pickableDeal({ economy_best_depart_date: "2026-09-11", economy_best_return_date: "2026-09-14" }), TODAY), "weekend_warrior");
  // D+21~90 = 얼리버드 (2026-10-15, D+37)
  assert.equal(weeklyPickPersona(pickableDeal({ economy_best_depart_date: "2026-10-15", economy_best_return_date: "2026-10-20" }), TODAY), "early_bird");
  // 절감 15%+ = 딜헌터
  assert.equal(weeklyPickPersona(pickableDeal({ economy_best_depart_date: "2026-09-16", economy_best_return_date: "2026-09-18", economy_discount_pct: 16 }), TODAY), "deal_hunter");
  // 화–목 출발·D+3·절감 4% = 어느 페르소나도 아님 → 픽 아님
  assert.equal(weeklyPickPersona(pickableDeal({ economy_best_depart_date: "2026-09-10", economy_best_return_date: "2026-09-16", economy_discount_pct: 4 }), TODAY), null);
});

test("curateWeeklyPicks never pads with unevidenced deals", () => {
  const picks = curateWeeklyPicks([
    pickableDeal({ destination_code: "FUK" }),
    pickableDeal({ destination_code: "TPE", last_seen_at: null }), // 관측 없음 → 제외
    pickableDeal({ destination_code: "TAO", economy_discount_pct: 2 }), // 근거 없음 → 제외
    pickableDeal({ destination_code: "OIT", economy_discount_pct: 22, economy_best_depart_date: "2026-09-11", economy_best_return_date: "2026-09-14" }),
    pickableDeal({ destination_code: "CHI", economy_best_depart_date: "2026-10-15", economy_best_return_date: "2026-10-20" }), // D+37 얼리버드
  ], TODAY, 12);

  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((pick) => pick.deal.destination_code).sort(), ["CHI", "FUK", "OIT"]);

  const sections = weeklyPickSections(picks);
  assert.equal(sections.weekend.length, 1, "금–월 출발 픽이 주말치기 섹션에 오른다");
  assert.equal(sections.earlyBird.length, 1);
  assert.equal(sections.featured.length, 3, "상위 픽 섹션은 전체 픽");
});

test("tracking sub_id carries only surface, pick id and freshness", () => {
  assert.equal(trackingSubId({ surface: "offers", pickId: "FUK_2026W38", freshness: "fresh" }), "offers_fuk_2026w38_fresh");
  assert.equal(trackingSubId({ surface: "home-pick" }), "home-pick");
  // 개인정보·임의 문자열은 세그먼트 화이트리스트 밖이다
  assert.equal(trackingSubId({ surface: "offers", pickId: "user@ex ample.com!!" }), "offers_user-ex-ample-com--");

  const tracked = withAffiliateTracking("https://tp.media/r?marker=abc&orig=ICN", { surface: "offers", pickId: "FUK", freshness: "delayed" });
  const url = new URL(tracked);
  assert.equal(url.searchParams.get("marker"), "abc", "기존 제휴 marker는 유지한다");
  assert.equal(url.searchParams.get("sub_id"), "offers_fuk_delayed");
  assert.equal(withAffiliateTracking("", { surface: "offers" }), "");
  assert.equal(withAffiliateTracking(null, { surface: "offers" }), "");
});
