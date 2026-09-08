import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isDealDisplayable } from "../lib/read-model/map-query.ts";

// DATA-20260906-001 2층(완료정의[2]): 노출 가격의 단일 진실원 계약.
// 표시가는 min(live offers)이어야 하고, live offer가 없는 딜(스테일 캐시 최저가·
// BKI형 오퍼 공백)은 비노출이 기본이다. 이 계약이 깨지면 스테일 최저가가 지도·홈에 오른다.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("deals without a live offer price are never displayable", () => {
  assert.equal(isDealDisplayable({ economy_min_total: null, business_min_total: null }), false, "live offer 0개 딜은 비노출이 기본");
  assert.equal(isDealDisplayable({ economy_min_total: 282780, business_min_total: null }), true);
  assert.equal(isDealDisplayable({ economy_min_total: null, business_min_total: 950000 }), true);
});

test("map query prices come from live offers, not the deals_current cache", () => {
  const source = readFileSync(join(repoRoot, "lib/read-model/map-query.ts"), "utf8");

  // 가격 열은 live_cabin(argmin) CTE에서, 후보 목록만 deals_current에서.
  assert.ok(source.includes("live_cabin"), "live offers argmin CTE가 없다 — 캐시 최저가를 그대로 표시한다");
  assert.ok(
    source.includes("eco.min_total_krw AS economy_min_total_krw"),
    "economy 최저가가 live 오퍼 최저가로 선택되지 않는다",
  );
  assert.ok(
    source.includes("biz.min_total_krw AS business_min_total_krw"),
    "business 최저가가 live 오퍼 최저가로 선택되지 않는다",
  );
  assert.ok(
    !source.includes("d.economy_min_total_krw AS") && !source.includes("d.business_min_total_krw AS"),
    "deals_current 캐시 최저가가 그대로 SELECT 투영되고 있다 — 정렬 힌트로만 쓸 열이다(H4 세대 비교 CASE의 참조는 허용)",
  );
  assert.ok(
    source.includes(".filter(isDealDisplayable)"),
    "live 가격 없는 딜을 걸러내는 isDealDisplayable 필터가 조회 체인에 없다",
  );
});

// 배치 성공 정의 이동(완료정의[2]): 소스 수집이 아니라 딜–오퍼 조인 노출 가능 비율.
test("ingest reports the deal-offer join ratio as the batch health metric", () => {
  const ingest = readFileSync(join(repoRoot, "scripts/ingest-collector-batch.mjs"), "utf8");
  const runner = readFileSync(join(repoRoot, "scripts/run-collector-sources.mjs"), "utf8");

  assert.ok(ingest.includes("measureDealOfferJoin"), "ingest summary에 조인 비율 측정이 없다");
  assert.ok(ingest.includes("deal_offer_join_ratio"), "deal_offer_join_ratio 지표가 ingest summary에 없다");
  assert.ok(runner.includes("deal_join_ratio_below_min"), "러너가 미달 플래그(부분 성공+경보)를 배치 상태에 싣지 않는다");
});

// 스템프 정직성: live 조인으로 바뀐 딜의 last_seen/last_batch는 live 오퍼 관측값을 따른다.
test("map deal observation stamps come from the live representative offer", () => {
  const source = readFileSync(join(repoRoot, "lib/read-model/map-query.ts"), "utf8");
  assert.ok(
    source.includes("eco.last_seen_at AS economy_last_seen_at"),
    "관측시각(economy_last_seen_at)이 live 오퍼에서 오지 않는다 — 캐시 스탬프로 오래된 관측을 최근인 것처럼 보인다",
  );
});

// H4(2026-09-08 핫픽스): 할인률은 캐시 최저가와 live 최저가가 같은 세대일 때만 노출 —
// 캐시 할인(구 가격 기준) + live 가격의 혼합 표시는 거짓 근거("평균 대비 N%")가 된다.
test("map query hides discount unless cache and live prices are the same generation", () => {
  const source = readFileSync(join(repoRoot, "lib/read-model/map-query.ts"), "utf8");
  assert.ok(
    source.includes("CASE WHEN d.economy_min_total_krw = eco.min_total_krw THEN d.economy_discount_pct END"),
    "economy 할인에 세대 가드(캐시가=live가)가 없다",
  );
  assert.ok(
    source.includes("CASE WHEN d.business_min_total_krw = biz.min_total_krw THEN d.business_discount_pct END"),
    "business 할인에 세대 가드(캐시가=live가)가 없다",
  );
  assert.ok(
    !source.includes("d.economy_discount_pct AS economy_discount_pct") && !source.includes("d.business_discount_pct AS business_discount_pct"),
    "가드 없는 캐시 할인 직접 노출이 남아 있다",
  );
});

// H4: 스윕 apply는 게이트가 읽는 키(batch_state.last_batch.deal_join_ratio)에 비율을 기록한다.
test("sweep apply records the join ratio under the gate-visible key", () => {
  const sweep = readFileSync(join(repoRoot, "scripts/sweep-stale-deals.mjs"), "utf8");
  assert.ok(sweep.includes("measureDealOfferJoin"), "apply 후 재측정이 없다");
  assert.ok(sweep.includes("deal_join_ratio: dealJoin.deal_offer_join_ratio"), "batch_state.last_batch.deal_join_ratio 기록이 없다");
  assert.ok(sweep.includes('ratio_key: "batch_state.last_batch.deal_join_ratio"'), "리포트에 ratio 키 이름이 없다");
});
