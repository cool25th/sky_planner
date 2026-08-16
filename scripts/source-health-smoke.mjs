import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { buildSourceReadinessSnapshot } from "../lib/source-readiness.ts";

const { Client } = pg;

export function parseArgs(argv) {
  const args = {
    databaseUrl: process.env.DATABASE_URL || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function resolveSourceHealthDatabaseUrl(options = {}) {
  const databaseUrl = String(options.databaseUrl ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or --database-url is required for source health smoke");
  }
  return databaseUrl;
}

export async function runSourceHealthSmoke(options = {}) {
  const client = new Client({ connectionString: resolveSourceHealthDatabaseUrl(options) });
  await client.connect();
  try {
    const healthResult = await client.query(`
        SELECT
          source_id,
          is_paused,
          enabled_by_flag,
          circuit_breaker_open,
          consecutive_failures,
          stats_24h,
          last_success_at,
          last_failure_at,
          last_failure_code,
          last_artifact_prefix,
          last_checked_at
        FROM source_health
      `);
    const jobsResult = await client.query(`
        SELECT DISTINCT ON (source_id)
          source_id,
          execution_id,
          status,
          parser_version,
          offers_found,
          offers_changed,
          snapshots_written,
          deals_recomputed,
          failure_code,
          last_error,
          started_at,
          completed_at,
          created_at
        FROM source_jobs
        ORDER BY source_id, created_at DESC
      `);
    const batchResult = await client.query("SELECT data FROM batch_state WHERE key = 'last_batch'");
    const snapshot = buildSourceReadinessSnapshot({
      healthRows: healthResult.rows,
      latestJobs: jobsResult.rows,
      batchState: batchResult.rows[0]?.data ?? null,
    });

    assert.equal(snapshot.last_batch?.status, "success", "last batch must be successful");
    assert.ok(snapshot.counts.env_enabled_sources > 0, "at least one source must be enabled by env");
    assert.ok(
      snapshot.counts.search_eligible_sources >= snapshot.counts.minimum_search_eligible_sources,
      `at least ${snapshot.counts.minimum_search_eligible_sources} enabled sources must be search eligible`,
    );
    assert.equal(snapshot.status, "ready", "source readiness should be ready for the seeded DB");

    console.log(JSON.stringify({
      status: "ok",
      readiness_status: snapshot.status,
      source_flags: snapshot.source_flags,
      counts: snapshot.counts,
      blocked_source_ids: snapshot.blocked_source_ids,
      last_batch: snapshot.last_batch,
    }, null, 2));
    return snapshot;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  runSourceHealthSmoke(args).catch((err) => {
    console.error("Source health smoke failed.");
    console.error(err);
    process.exit(1);
  });
}
