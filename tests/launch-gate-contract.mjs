import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
