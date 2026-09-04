import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// UX-20260905-001: 오퍼 품질 가드(매진·가격이상·품질제외)는 실데이터 SQL 4개 지점이
// 같은 계약을 적용해야 한다. offers-query만 가드가 없어 /map·검색·딜 재계산이 숨긴
// 오퍼가 /offers(예약 직전 화면)에 노출될 수 있었던 잠복 결함을 기계적으로 봉쇄한다.
const GUARDED_SQL_SITES = [
  "lib/read-model/offers-query.ts",
  "lib/read-model/calendar-query.ts",
  "lib/read-model/search-query.ts",
  "scripts/ingest-collector-batch.mjs",
];

const QUALITY_GUARDS = [
  "COALESCE(o.bookability_status, 'available') <> 'sold_out'",
  "COALESCE(o.price_status, 'active') <> 'sold_out'",
  "COALESCE(o.price_anomaly_status, 'normal') = 'normal'",
  "COALESCE(o.quality_bucket, 'preferred') <> 'excluded'",
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every live offer SQL site applies all four quality guards", () => {
  for (const site of GUARDED_SQL_SITES) {
    const source = readFileSync(join(repoRoot, site), "utf8");
    for (const guard of QUALITY_GUARDS) {
      assert.ok(
        source.includes(guard),
        `${site}에 품질 가드 누락: ${guard} — 매진/이상가 오퍼가 해당 경로로 새어 나간다`,
      );
    }
  }
});
