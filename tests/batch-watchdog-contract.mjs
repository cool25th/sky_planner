import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// TEST-20260831-001: DATA-20260828-001 완화 장치(batch-watchdog)의 구조 계약 —
// 스케줄 cron 3회·20h 개입 임계·판독 불가 시 개입·daily-batch workflow_call 수신.
// GitHub 스케줄러가 best-effort인 지금 이 워크플로가 유일한 자동 개입 경로라 회귀 방어가 필요하다.

async function workflow(name) {
  return readFile(path.join(process.cwd(), ".github/workflows", name), "utf8");
}

test("watchdog checks batch freshness three times covering the stale deadline window", async () => {
  const yaml = await workflow("batch-watchdog.yml");
  for (const cron of ['"0 18 * * *"', '"0 20 * * *"', '"0 23 * * *"']) {
    assert.ok(yaml.includes(`- cron: ${cron}`), `missing schedule ${cron}`);
  }
  assert.match(yaml, /workflow_dispatch:/);
});

test("watchdog intervenes when last batch age is unreadable or beyond 20 hours", async () => {
  const yaml = await workflow("batch-watchdog.yml");
  assert.match(yaml, /last_batch\.last_batch_at/);
  assert.match(yaml, /h >= 20/);
  // 판독 불가(-z "$hours")도 개입 — 배치 1회 추가 실행은 멱등이라 안전.
  assert.match(yaml, /\[ -z "\$hours" \]/);
});

test("watchdog rescue reuses daily-batch via workflow_call with inherited secrets", async () => {
  const yaml = await workflow("batch-watchdog.yml");
  assert.match(yaml, /uses: \.\/\.github\/workflows\/daily-batch\.yml/);
  assert.match(yaml, /secrets: inherit/);
});

test("daily-batch accepts workflow_call from the watchdog", async () => {
  const yaml = await workflow("daily-batch.yml");
  assert.match(yaml, /^ {2}workflow_call:$/m);
});

test("daily-batch keeps two nightly schedule slots for scheduler-delay redundancy", async () => {
  // DATA-20260828-001 완화: GitHub 스케줄 지연(관측 최대 8h15m)에 도착 기회를 2배로 늘린다.
  // 배치는 멱등이라 같은 날 2회 실행이 무해하다(2026-09-01 이중 실행 실측).
  const yaml = await workflow("daily-batch.yml");
  for (const cron of ['"30 15 * * *"', '"0 17 * * *"']) {
    assert.ok(yaml.includes(`- cron: ${cron}`), `missing schedule ${cron}`);
  }
});
