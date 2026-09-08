import "server-only";

import { query } from "@/lib/db";
import {
  enabledSourceFlagsFromEnv,
  sourceHealthBlockReason,
  sourceMaxStaleHoursFromEnv,
} from "@/lib/source-policy";
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
  // H2(2026-09-08 핫픽스): env 활성 소스별 차단 사유(sourceHealthBlockReason 결과).
  // last-good은 "stale" 차단만 완화하고 paused/circuit_breaker_open/consecutive_failures 등으로
  // 차단된 소스의 데이터를 부활시키지 않는다.
  sourceBlockReasons: Record<string, string | null>;
}

export async function resolveSourceContext(batchState: { lastBatchAt: string }): Promise<SourceContext> {
  const envFlags = enabledSourceFlagsFromEnv();
  if (!postgresConfigured() || !envFlags.length) {
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: null,
      sourceBlockReasons: Object.fromEntries(envFlags.map((flag) => [flag, null])),
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
    const healthBySource = new Map(healthResult.rows.map((row) => [String(row.source_id ?? ""), row]));
    const maxStaleHours = sourceMaxStaleHoursFromEnv();
    const now = new Date();
    return {
      sourceFlags: readiness.source_flags,
      readiness: {
        status: readiness.status,
        counts: readiness.counts,
        blocked_source_ids: readiness.blocked_source_ids,
      },
      sourceHealthError: null,
      sourceBlockReasons: Object.fromEntries(
        envFlags.map((flag) => [flag, sourceHealthBlockReason(healthBySource.get(flag), now, maxStaleHours)]),
      ),
    };
  } catch (err) {
    console.error("Failed to fetch source health from PostgreSQL, using env source flags.", err);
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: "postgres_source_health_query_failed",
      sourceBlockReasons: Object.fromEntries(envFlags.map((flag) => [flag, null])),
    };
  }
}
