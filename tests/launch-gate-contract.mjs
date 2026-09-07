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
