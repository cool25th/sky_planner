import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// TEST-20260901-001: warmup 워크플로 구조 계약 — PERF-20260831-001이 cron을 07시→05시로
// 확장했으나 batch-watchdog과 달리 계약 가드가 없었다. 스케줄 커버리지(새벽 콜드 공백 방지)와
// 예열 대상(홈+map API)이 조용히 좁아지는 회귀를 봉쇄한다.

async function workflow() {
  return readFile(path.join(process.cwd(), ".github/workflows/warmup.yml"), "utf8");
}

test("warmup covers KST 05:00-23:59 every 30 minutes", async () => {
  const yaml = await workflow();
  assert.ok(yaml.includes('- cron: "3,33 20-23,0-14 * * *"'), "missing expanded schedule (PERF-20260831-001)");
  assert.match(yaml, /workflow_dispatch:/);
});

test("warmup pings the site home and the read-model map API", async () => {
  const yaml = await workflow();
  assert.ok(yaml.includes("https://skyplanner-kappa.vercel.app/"), "home warmup missing");
  assert.ok(yaml.includes("https://skyplanner-kappa.vercel.app/api/deals/map"), "map API warmup missing");
});

test("warmup runs are serialized, not cancelled", async () => {
  const yaml = await workflow();
  assert.match(yaml, /concurrency:/);
  assert.match(yaml, /cancel-in-progress: false/);
});
