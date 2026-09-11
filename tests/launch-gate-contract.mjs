import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateLaunchGate,
  LAUNCH_GATE_THRESHOLDS,
} from "../lib/launch-gate.ts";

// 완료정의[5]: 출시·인덱싱 게이트는 P0 축만 본다 — 스테일 최저가 <15%·데모 폴백 0·주간 픽 존재·실패 감지.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function passingInput(overrides = {}) {
  return {
    dealOfferJoinRatio: 0.93, // 스테일 7%
    weeklyPickableDeals: 6,
    failureDetectionReady: true,
    demoObserved: false, // H6: 런타임 관측에서 demo가 아님
    defaultViewCities: 21, // UX-20260910-004: 기본 뷰 도시 하한 충족
    ...overrides,
  };
}

test("launch gate passes only when every P0 axis holds", () => {
  assert.equal(evaluateLaunchGate(passingInput()).passed, true);

  assert.equal(evaluateLaunchGate(passingInput({ dealOfferJoinRatio: 0.8 })).passed, false, "스테일 20%는 게이트 실패");
  assert.equal(evaluateLaunchGate(passingInput({ dealOfferJoinRatio: null })).passed, false, "조인 비율 미측정도 게이트 실패");
  assert.equal(evaluateLaunchGate(passingInput({ weeklyPickableDeals: 0 })).passed, false, "주간 픽 없음은 게이트 실패");
  assert.equal(evaluateLaunchGate(passingInput({ failureDetectionReady: false })).passed, false, "실패 감지 부재는 게이트 실패");
});

// H6: 데모 축은 고무도장이 아니라 런타임 관측이다 — demo 관측·관측 실패 모두 게이트를 닫는다.
test("demo axis fails on observed demo mode and on failed observation", () => {
  assert.equal(evaluateLaunchGate(passingInput({ demoObserved: true })).passed, false, "map API가 demo로 관측되면 게이트 실패");
  const closed = evaluateLaunchGate(passingInput({ demoObserved: null }));
  assert.equal(closed.passed, false, "관측 실패는 fail-closed");
  assert.match(
    closed.checks.find((check) => check.id === "demo_fallback_absent").detail,
    /fail-closed/,
  );
});

test("page meta noindex is wired to the gate, not robots.txt alone", () => {
  const layout = readFileSync(join(repoRoot, "app/layout.tsx"), "utf8");
  assert.ok(layout.includes("generateMetadata"), "레이아웃 메타가 게이트를 읽지 않는다");
  assert.ok(layout.includes("index: false"), "게이트 실패 시 noindex 메타가 없다");
  const gateSource = readFileSync(join(repoRoot, "lib/launch-gate.ts"), "utf8");
  assert.ok(gateSource.includes("probeMapDataMode"), "데모 축의 런타임 관측(probe)이 없다");
  assert.ok(gateSource.includes('mode === "demo"'));
});

test("stale percentage derives from the deal-offer join ratio", () => {
  const gate = evaluateLaunchGate(passingInput({ dealOfferJoinRatio: 0.849 }));
  assert.equal(gate.stale_lowest_price_pct, 15.1);
  const threshold = evaluateLaunchGate(passingInput({
    dealOfferJoinRatio: 1 - LAUNCH_GATE_THRESHOLDS.maxStaleLowestPricePct / 100,
  }));
  assert.equal(threshold.stale_lowest_price_pct, 15);
  assert.equal(threshold.checks.find((check) => check.id === "stale_lowest_price_under_threshold").passed, false, "15% 미만(<)이어야 통과 — 15%는 실패");
});

test("ops launch-gate route stays thin and delegates to the lib gate", () => {
  const route = readFileSync(join(repoRoot, "app/api/ops/launch-gate/route.ts"), "utf8");
  assert.ok(route.includes("readLaunchGate"));
  assert.ok(route.includes("503"), "게이트 실패는 503으로 관측된다");
});

test("default view city floor is a fail-closed axis", () => {
  // UX-20260910-004: 기본 뷰(ICN·현재 주차·5_7)의 live 도시 수 하한 — 죽어가는 주차에 지도가
  // 퇴화하면 첫인상이 고착된다(기존 4축과 같은 맥락의 fail-closed 색인 축).
  const thin = evaluateLaunchGate(passingInput({ defaultViewCities: 2 }));
  assert.equal(thin.passed, false, "기본 뷰 2개 도시는 게이트 실패");
  assert.equal(thin.checks.find((check) => check.id === "default_view_city_floor").passed, false);

  const floor = evaluateLaunchGate(passingInput({ defaultViewCities: LAUNCH_GATE_THRESHOLDS.minDefaultViewCities }));
  assert.equal(floor.checks.find((check) => check.id === "default_view_city_floor").passed, true, "하안(5) 이상이면 통과");

  const unmeasured = evaluateLaunchGate(passingInput({ defaultViewCities: null }));
  assert.equal(unmeasured.checks.find((check) => check.id === "default_view_city_floor").passed, false, "측정 불가는 fail-closed");

  const gateSource = readFileSync(join(repoRoot, "lib/launch-gate.ts"), "utf8");
  assert.match(gateSource, /readDefaultViewCities/, "기본 뷰 도시 수는 게이트가 직접 측정한다");
  assert.match(gateSource, /minDefaultViewCities: 5/);
});

test("default view SQL keeps the live CTE joinable on traveler", () => {
  // 2026-09-10 배포 실측: CTE가 o.traveler를 SELECT하지 않아 l.traveler 조인이 SQL 오류로
  // 축이 "미측정"(fail-closed)으로 떨어졌다 — 조인이 참조하는 열은 CTE가 싣는다.
  const gateSource = readFileSync(join(repoRoot, "lib/launch-gate.ts"), "utf8");
  const fn = gateSource.slice(gateSource.indexOf("async function readDefaultViewCities"));
  const cte = fn.slice(fn.indexOf("WITH live AS ("), fn.indexOf("SELECT count"));
  assert.match(cte, /o\.traveler/, "live CTE는 traveler를 선택해 조인 가능해야 한다");
  assert.match(fn, /l\.traveler = d\.traveler/);
});

test("readLaunchGate caches evaluations for 60s (Neon egress fix 2026-09-11)", () => {
  // INT-20260910-001 트리거 도래: robots·사이트맵·metadata가 게이트를 요청마다 평가(쿼리 2회+
  // map API 자기 fetch) — 색인 개방 후 크롤 트래픽이 Neon 무료 이그레스를 소진한다(09-11 위기).
  // readLaunchGate는 실DB/fetch 경로라 여기선 소스 스캔으로 계약 고정(헤르메틱).
  const source = readFileSync(join(repoRoot, "lib/launch-gate.ts"), "utf8");
  assert.match(source, /LAUNCH_GATE_CACHE_TTL_MS = 60_000/);
  assert.match(source, /gateCache && Date\.now\(\) - gateCache\.at < LAUNCH_GATE_CACHE_TTL_MS/);
  assert.match(source, /gateCache = \{ at: Date\.now\(\), result \}/);
  assert.match(source, /resetLaunchGateCacheForTests/);
});
