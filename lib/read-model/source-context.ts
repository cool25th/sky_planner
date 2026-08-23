import "server-only";

import { query } from "@/lib/db";
import { enabledSourceFlagsFromEnv } from "@/lib/source-policy";
import { buildSourceReadinessSnapshot } from "@/lib/source-readiness";

export function postgresConfigured() {
  return Boolean(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
}

export interface SourceContext {
  sourceFlags: string[];
  readiness: {
    status: string;
    counts: Record<string, unknown>;
    blocked_source_ids: string[];
  } | null;
  sourceHealthError: string | null;
}

export async function resolveSourceContext(batchState: { lastBatchAt: string }): Promise<SourceContext> {
  const envFlags = enabledSourceFlagsFromEnv();
  if (!postgresConfigured() || !envFlags.length) {
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: null,
    };
  }

  try {
    const [healthResult, batchResult] = await Promise.all([
      query(`
        SELECT source_id, is_paused, enabled_by_flag, circuit_breaker_open, consecutive_failures, last_success_at
        FROM source_health
        WHERE source_id = ANY($1::text[])
      `, [envFlags]),
      query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1"),
    ]);
    const readiness = buildSourceReadinessSnapshot({
      healthRows: healthResult.rows,
      batchState: batchResult.rows[0]?.data ?? {
        status: "unknown",
        last_batch_at: batchState.lastBatchAt,
      },
    });
    return {
      sourceFlags: readiness.source_flags,
      readiness: {
        status: readiness.status,
        counts: readiness.counts,
        blocked_source_ids: readiness.blocked_source_ids,
      },
      sourceHealthError: null,
    };
  } catch (err) {
    console.error("Failed to fetch source health from PostgreSQL, using env source flags.", err);
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: "postgres_source_health_query_failed",
    };
  }
}
