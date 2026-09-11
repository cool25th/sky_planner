import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// TEST-20260901-001: warmup 워크플로 구조 계약. OPS-20260911-001(2026-09-11 사용자 결정)로
// 30분 주기→6시간 주기로 완화(Neon 무료 이그레스 5GB/월 소진 위기 — 배치·게이트 이그레스 차단과
// 함께 CU·이그레스 절감). 예열 대상(홈+map API)과 직렬화가 조용히 좁아지는 회귀를 봉쇄한다.

async function workflow() {
  return readFile(path.join(process.cwd(), ".github/workflows/warmup.yml"), "utf8");
}

test("warmup runs every 6 hours (4 runs/day — OPS-20260911-001 relaxation)", async () => {
  const yaml = await workflow();
  assert.ok(yaml.includes('- cron: "7 */6 * * *"'), "missing 6-hour schedule (OPS-20260911-001)");
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
