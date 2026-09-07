import "server-only";

import type { ApiResponse } from "@/lib/mock-market";
import { isRetryableConnectionError } from "@/lib/db";
import { serviceApiReadinessBlockReason } from "@/lib/service-api-readiness";
import { serviceRequiresPostgres } from "@/lib/service-mode";
import type { SourceContext } from "./source-context";
import { postgresConfigured } from "./source-context";

export type ReadModel = "postgres" | "last_good" | "mock" | "unavailable";

export function addDiagnostics<T>(
  response: ApiResponse<T>,
  readModel: ReadModel,
  sourceContext: SourceContext,
  fallbackReason: string | null = null,
): ApiResponse<T> {
  return {
    ...response,
    diagnostics: {
      read_model: readModel,
      data_mode: readModel === "postgres"
        ? "live"
        : readModel === "last_good"
          ? "last_good"
          : readModel === "mock"
            ? "demo"
            : "unavailable",
      postgres_configured: postgresConfigured(),
      fallback_used: readModel === "mock" || readModel === "last_good",
      fallback_suppressed: readModel === "unavailable",
      fallback_reason: fallbackReason,
      service_requires_postgres: serviceRequiresPostgres(),
      service_unavailable: readModel === "unavailable",
      source_flags: response.source_flags,
      source_readiness: sourceContext.readiness,
      source_health_error: sourceContext.sourceHealthError,
    },
  };
}

export function dataModeLabel(diagnostics?: Record<string, unknown>): string {
  // DATA-20260908-001: 운영(unavailable·last_good)에서 "데모 데이터" 라벨이 나오면 실제로는
  // 데모가 아닌 응답까지 가짜로 읽힌다 — 모드별로 정직한 라벨만 매핑한다(미지정만 데모 유지).
  if (diagnostics?.data_mode === "live") return "실시간 데이터";
  if (diagnostics?.data_mode === "last_good") return "마지막 수집 데이터";
  if (diagnostics?.data_mode === "unavailable") return "데이터 일시 중단";
  return "데모 데이터";
}

export function sanitizedPostgresFailure(err: unknown) {
  console.error("Failed to fetch data from PostgreSQL.", err);
  // 연결 계열(콜드스타트·네트워크)과 쿼리 계열을 구분해도 문자열 상수만 노출한다(내부 정보 비노출 유지).
  return isRetryableConnectionError(err) ? "postgres_connection_failed" : "postgres_query_failed";
}

export function suppressMockFallback<T>(
  response: ApiResponse<T>,
  sourceContext: SourceContext,
  fallbackReason: string | null,
) {
  return addDiagnostics(
    {
      ...response,
      warning_flags: [...new Set([...response.warning_flags, "service_read_model_unavailable"])],
    },
    "unavailable",
    sourceContext,
    fallbackReason,
  );
}

export function sourceReadinessFallbackReason(sourceContext: SourceContext) {
  return serviceApiReadinessBlockReason({
    postgresConfigured: postgresConfigured(),
    sourceHealthError: sourceContext.sourceHealthError,
    sourceReadiness: sourceContext.readiness,
  });
}
