import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  resolveSourceHealthDatabaseUrl,
} from "../scripts/source-health-smoke.mjs";

test("source health smoke requires an explicit database URL", () => {
  assert.throws(
    () => resolveSourceHealthDatabaseUrl({ databaseUrl: "" }),
    /DATABASE_URL or --database-url is required/,
  );
});

test("source health smoke accepts an explicit database URL argument", () => {
  const args = parseArgs([
    "--database-url",
    "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
  ]);

  assert.equal(
    resolveSourceHealthDatabaseUrl(args),
    "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
  );
});

test("source health smoke rejects unknown arguments", () => {
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument: --unknown/);
});

test("source health route gates on the shared postgresConfigured predicate", async () => {
  // INT-20260903-002: 게이트가 legacy DATABASE_URL만 보면 READ_URL 구성 환경에서 오탐 503 —
  // 조회 경로(lib/db.ts)와 같은 READ_URL 우선 기준으로 통일됐는지 소스로 고정한다.
  const { readFile } = await import("node:fs/promises");
  const route = await readFile("app/api/ops/source-health/route.ts", "utf8");
  assert.match(route, /if \(!postgresConfigured\(\)\)/);
  assert.match(route, /import \{ postgresConfigured \} from "@\/lib\/launch-gate"/);
  assert.doesNotMatch(route, /if \(!process\.env\.DATABASE_URL\)/);
});
