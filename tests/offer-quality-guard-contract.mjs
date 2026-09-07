import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// UX-20260905-001: 오퍼 품질 가드(매진·가격이상·품질제외)는 live offer SQL 6개 지점이
// 같은 계약을 적용해야 한다. DATA-20260906-001 2층부터 가드 문은 공유 모듈
// lib/read-model/live-offer-policy.ts에 정의되고 각 지점은 LIVE_OFFER_VISIBILITY_SQL로 조인한다.
const GUARDED_SQL_SITES = [
  "lib/read-model/map-query.ts",
  "lib/read-model/offers-query.ts",
  "lib/read-model/calendar-query.ts",
  "lib/read-model/search-query.ts",
  "scripts/ingest-collector-batch.mjs",
  "scripts/sweep-stale-deals.mjs",
];

const SHARED_POLICY = "lib/read-model/live-offer-policy.ts";

const QUALITY_GUARDS = [
  "COALESCE(o.bookability_status, 'available') <> 'sold_out'",
  "COALESCE(o.price_status, 'active') <> 'sold_out'",
  "COALESCE(o.price_anomaly_status, 'normal') = 'normal'",
  "COALESCE(o.quality_bucket, 'preferred') <> 'excluded'",
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("shared live-offer policy defines all four quality guards", () => {
  const policy = readFileSync(join(repoRoot, SHARED_POLICY), "utf8");
  for (const guard of QUALITY_GUARDS) {
    assert.ok(policy.includes(guard), `${SHARED_POLICY}에 품질 가드 누락: ${guard}`);
  }
});

test("every live offer SQL site shares the single visibility contract", () => {
  for (const site of GUARDED_SQL_SITES) {
    const source = readFileSync(join(repoRoot, site), "utf8");
    assert.ok(
      source.includes("LIVE_OFFER_VISIBILITY_SQL"),
      `${site}가 공유 가드(LIVE_OFFER_VISIBILITY_SQL)를 쓰지 않는다 — 매진/이상가 오퍼가 해당 경로로 새어 나간다`,
    );
  }
});

// DATA-20260906-001: 딜 최저가 재료의 72h 신선도 계약은 lib/fare-freshness(isHiddenFare,
// /offers가 클라이언트측으로 적용)와 짝을 이룬다 — 한쪽 상수만 바꾸면 맵과 /offers가 다른
// 가격 세계를 보여준다(2026-09-06 실측: 활성 딜의 52%가 최저가 오퍼 스테일).
test("deal materialization freshness contract stays paired with fare-freshness", () => {
  const freshness = readFileSync(join(repoRoot, "lib/fare-freshness.ts"), "utf8");
  const policy = readFileSync(join(repoRoot, SHARED_POLICY), "utf8");

  const hours = freshness.match(/HIDDEN_AFTER_HOURS = (\d+)/)?.[1];
  assert.ok(hours, "lib/fare-freshness.ts에 HIDDEN_AFTER_HOURS 상수가 없다");
  assert.ok(
    policy.includes(`LIVE_OFFER_MAX_AGE_HOURS = ${hours}`),
    `${SHARED_POLICY}의 신선도 상수가 HIDDEN_AFTER_HOURS(${hours}h)와 짝이 아니다`,
  );
  assert.ok(
    policy.includes(`interval '\${LIVE_OFFER_MAX_AGE_HOURS} hours'`),
    `${SHARED_POLICY} 가드 SQL에 last_seen_at 상한이 없다 — 스테일 오퍼의 죽은 가격이 live로 둔갑한다`,
  );
  assert.ok(
    readFileSync(join(repoRoot, "lib/read-model/offers-query.ts"), "utf8").includes("isHiddenFare"),
    "offers-query의 클라이언트측 isHiddenFare 필터가 사라졌다 — 신선도 계약의 읽기측 짝",
  );
});
