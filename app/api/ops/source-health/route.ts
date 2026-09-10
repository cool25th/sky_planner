import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { errorMessage } from "@/lib/error-message";
import { postgresConfigured } from "@/lib/launch-gate";
import {
  enrichInternalSourceReadinessSnapshot,
  opsJsonHeaders,
  redactSourceReadinessSnapshot,
  resolveOpsRequestVisibility,
  sourceHealthUnavailablePayload,
} from "@/lib/ops-visibility";
import { buildSourceReadinessSnapshot } from "@/lib/source-readiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = resolveOpsRequestVisibility(request);
  // INT-20260903-002: 게이트는 실제 조회 경로(lib/db.ts)와 같은 기준(READ_URL 우선)으로 —
  // legacy DATABASE_URL 축소 시 DB가 정상이어도 ops 관측만 오탐 503로 죽는 일을 막는다.
  if (!postgresConfigured()) {
    const payload = sourceHealthUnavailablePayload(access.visibility, {
      reason: "database_url_missing",
      error: "DATABASE_READ_URL or DATABASE_URL is required for collector source health.",
    });
    return NextResponse.json(payload, {
      status: 503,
      headers: opsJsonHeaders(access.visibility),
    });
  }

  try {
    const [healthResult, jobsResult, batchResult] = await Promise.all([
      query(`
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
      `),
      query(`
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
      `),
      query("SELECT data FROM batch_state WHERE key = 'last_batch'"),
    ]);

    const snapshot = buildSourceReadinessSnapshot({
      healthRows: healthResult.rows,
      latestJobs: jobsResult.rows,
      batchState: batchResult.rows[0]?.data ?? null,
    });
    const payload = access.visibility === "internal"
      ? enrichInternalSourceReadinessSnapshot(snapshot)
      : redactSourceReadinessSnapshot(snapshot);

    return NextResponse.json(payload, {
      status: snapshot.status === "ready" ? 200 : 503,
      headers: opsJsonHeaders(access.visibility),
    });
  } catch (err) {
    return NextResponse.json(sourceHealthUnavailablePayload(access.visibility, {
      reason: "source_health_query_failed",
      error: errorMessage(err, "source_health_query_failed"),
    }), {
      status: 503,
      headers: opsJsonHeaders(access.visibility),
    });
  }
}
