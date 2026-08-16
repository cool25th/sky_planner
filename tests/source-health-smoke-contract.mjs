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
