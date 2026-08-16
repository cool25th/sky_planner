import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migrationDatabaseUrl, runMigrations } from "../scripts/migrate-postgres.mjs";

class FakeClient {
  constructor(options = {}) {
    this.failOn = options.failOn ?? null;
    this.statements = [];
  }

  async connect() {}

  async query(sql) {
    this.statements.push(sql);
    if (this.failOn && sql.includes(this.failOn)) throw new Error("ddl rejected");
    return { rows: [] };
  }

  async end() {}
}

function recordingClient(instances, options = {}) {
  return class extends FakeClient {
    constructor() {
      super(options);
      instances.push(this);
    }
  };
}

test("migration database url prefers the migration role over the legacy fallback", () => {
  assert.equal(
    migrationDatabaseUrl({
      DATABASE_MIGRATION_URL: "postgresql://migration:pw@db.example.com/sky",
      DATABASE_URL: "postgresql://root:pw@db.example.com/sky",
    }),
    "postgresql://migration:pw@db.example.com/sky",
  );
  assert.equal(
    migrationDatabaseUrl({ DATABASE_URL: "postgresql://root:pw@db.example.com/sky" }),
    "postgresql://root:pw@db.example.com/sky",
  );
  assert.equal(migrationDatabaseUrl({}), "");
});

test("runMigrations applies sql files in order inside per-file transactions", async () => {
  const sqlDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-migrate-"));
  const instances = [];
  try {
    await writeFile(path.join(sqlDir, "002_second.sql"), "CREATE TABLE b (id TEXT);\n");
    await writeFile(path.join(sqlDir, "001_first.sql"), "CREATE TABLE a (id TEXT);\n");

    const summary = await runMigrations({
      connectionString: "postgresql://migration:pw@db.example.com/sky",
      sqlDir,
      Client: recordingClient(instances),
    });

    assert.equal(summary.status, "applied");
    assert.deepEqual(summary.applied, ["001_first.sql", "002_second.sql"]);
    assert.equal(summary.count, 2);
    assert.equal(instances.length, 1);
    const statements = instances[0].statements;
    const firstSqlIndex = statements.findIndex((sql) => sql.includes("CREATE TABLE a"));
    assert.ok(statements.slice(0, firstSqlIndex).every((sql) => !sql.includes("CREATE TABLE")));
    assert.ok(statements.includes("BEGIN"));
    assert.ok(statements.filter((sql) => sql === "COMMIT").length >= 2);
  } finally {
    await rm(sqlDir, { recursive: true, force: true });
  }
});

test("runMigrations rolls back and reports the failing file", async () => {
  const sqlDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-migrate-"));
  const instances = [];
  try {
    await writeFile(path.join(sqlDir, "001_ok.sql"), "CREATE TABLE a (id TEXT);\n");
    await writeFile(path.join(sqlDir, "002_bad.sql"), "CREATE TABLE b (id TEXT);\n");

    await assert.rejects(
      () => runMigrations({
        connectionString: "postgresql://migration:pw@db.example.com/sky",
        sqlDir,
        Client: recordingClient(instances, { failOn: "CREATE TABLE b" }),
      }),
      /Migration failed: 002_bad\.sql/,
    );
    assert.ok(instances[0].statements.includes("ROLLBACK"));
  } finally {
    await rm(sqlDir, { recursive: true, force: true });
  }
});

test("runMigrations requires a database url and sql files", async () => {
  await assert.rejects(
    () => runMigrations({ connectionString: "", env: {}, sqlDir: ".", Client: FakeClient }),
    /DATABASE_MIGRATION_URL or DATABASE_URL is required/,
  );
  const emptyDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-empty-"));
  try {
    await assert.rejects(
      () => runMigrations({ connectionString: "postgresql://x@y/z", sqlDir: emptyDir, Client: FakeClient }),
      /No migration SQL files found/,
    );
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});
