export interface ServiceUnavailableNoticeCopy {
  kicker: string;
  title: string;
  body: string;
  statusLabel: string;
  detailLabel: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function isServiceUnavailableDiagnostics(diagnostics: unknown): boolean {
  const record = asRecord(diagnostics);
  if (!record) return false;
  const sourceReadiness = asRecord(record.source_readiness);
  return (
    record.service_unavailable === true ||
    (record.read_model === "unavailable" && record.fallback_suppressed === true) ||
    (
      record.service_requires_postgres === true &&
      sourceReadiness !== null &&
      sourceReadiness.status !== "ready"
    )
  );
}

export function serviceUnavailableNotice(diagnostics: unknown): ServiceUnavailableNoticeCopy {
  const record = asRecord(diagnostics);
  const sourceHealthUnavailable = record?.source_health_error === "postgres_source_health_query_failed";
  const sourceReadiness = asRecord(record?.source_readiness);
  const sourceReadinessUnavailable = sourceReadiness !== null && sourceReadiness.status !== "ready";

  return {
    kicker: "Service unavailable",
    title: "운임 데이터를 표시할 수 없습니다",
    body: "운영 read model이 응답하지 않아 임시 데이터 표시를 중단했습니다. 데이터가 복구되면 검색 결과가 다시 표시됩니다.",
    statusLabel: "Read model unavailable",
    detailLabel: sourceHealthUnavailable
      ? "Source health 점검 필요"
      : sourceReadinessUnavailable
        ? "Source readiness 점검 필요"
        : "Mock fallback 차단됨",
  };
}
