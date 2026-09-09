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
      // DATA-20260908-001: live·last_good 응답은 readiness가 not_ready여도 데이터를 싣고 있다 —
      // 장애 안내로 덮으면 last-good 폴백이 무의미해진다.
      record.read_model !== "postgres" &&
      record.read_model !== "last_good" &&
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

  // H5(승인 대기 카피): 사용자 톤 — "특가 갱신 지연, 재시도 중". 엔지니어 용어(Read model 등)는 노출하지 않는다.
  return {
    kicker: "특가 갱신 지연",
    title: "운임 데이터를 표시할 수 없습니다",
    body: "특가 갱신이 지연되고 있어요. 잠시 후 다시 확인해 주세요. 데이터가 복구되면 특가가 다시 표시됩니다.",
    statusLabel: "재시도 중",
    detailLabel: sourceHealthUnavailable
      ? "수집 연결 점검 중"
      : sourceReadinessUnavailable
        ? "데이터 수집 점검 중"
        : "데이터 대기 중",
  };
}
