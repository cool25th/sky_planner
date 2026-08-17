import Link from "next/link";

import { redactServiceReadinessSnapshot } from "@/lib/ops-visibility";
import { getServiceReadinessSnapshot } from "@/lib/service-readiness-runtime";

const CHECK_LABELS: Record<string, string> = {
  postgres_read_model_configured: "운영 DB 연결",
  postgres_read_model_queryable: "DB 조회 가능",
  fresh_successful_batch: "최근 배치 성공",
  last_batch_source_coverage: "최근 배치 source",
  eligible_sources_minimum: "검색 가능 source",
  source_policy_catalog_coverage: "source policy 등록",
  live_collector_success: "실제 collector 성공",
  collector_manifest_configured: "운영 manifest",
  source_credentials_present: "source secret",
  inventory_present: "활성 재고",
  booking_deeplink_sample_present: "예약 링크 샘플",
  booking_deeplink_sample_depth: "예약 링크 샘플 깊이",
  booking_deeplink_shape: "예약 링크 형식",
  booking_deeplink_source_coverage: "source별 예약 링크",
  source_health_ready: "source health",
  collector_success_rate_7d: "7일 collector 성공률",
  alert_channel_configured: "알림 채널",
  readiness_api_available: "readiness API",
  ops_readiness_token_configured: "ops 접근 토큰",
  mock_fallback_disabled: "mock fallback 차단",
  source_kill_switches_configured: "source kill switch 설정",
  source_max_stale_hours_configured: "source freshness 기준",
  status_page_available: "상태 페이지",
  trust_cues_available: "검색 신뢰 표시",
  service_unavailable_ui_available: "장애 안내 화면",
  search_inventory_available: "검색 재고",
  support_contact_configured: "문의 채널",
  public_policy_page: "정책 페이지",
  affiliate_disclosure: "제휴 고지",
  data_accuracy_disclosure: "가격 고지",
  support_contact_disclosure: "문의 고지",
  ops_runbook_available: "운영 runbook",
  env_template_available: "환경 변수 템플릿",
  runtime_env_preflight_available: "런타임 env gate",
  contract_test_gate_available: "계약 테스트 gate",
  production_build_gate_available: "production build gate",
  production_manifest_template_available: "운영 manifest 템플릿",
  collector_workflow_gate_configured: "수집 workflow gate",
  collector_artifact_upload_configured: "collector artifact 보존",
  kill_switch_available: "source kill switch",
  public_api_503_guard_available: "public API 503 guard",
  production_gate_available: "출시 gate",
  service_gate_available: "서비스 gate",
  ops_alert_gate_available: "알림 전달 gate",
  service_launch_audit_available: "런칭 audit",
};

function statusLabel(status: string) {
  if (status === "ready" || status === "pass") return "Ready";
  if (status === "warn") return "Watch";
  return "Blocked";
}

function statusClass(status: string) {
  if (status === "ready" || status === "pass") return "is-ready";
  if (status === "warn") return "is-watch";
  return "is-blocked";
}

function formatStamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDetail(detail: Record<string, unknown> | undefined) {
  if (!detail) return "";
  if (Array.isArray(detail.missing_source_ids) && detail.missing_source_ids.length > 0) {
    return `missing: ${detail.missing_source_ids.join(", ")}`;
  }
  if (Array.isArray(detail.missing_live_source_ids) && detail.missing_live_source_ids.length > 0) {
    return `live missing: ${detail.missing_live_source_ids.join(", ")}`;
  }
  if (typeof detail.missing_source_count === "number" && detail.missing_source_count > 0) {
    return `missing sources: ${detail.missing_source_count}`;
  }
  if (typeof detail.missing_live_source_count === "number" && detail.missing_live_source_count > 0) {
    return `live missing: ${detail.missing_live_source_count}`;
  }
  if (typeof detail.missing_count === "number" && detail.missing_count > 0) {
    return `missing: ${detail.missing_count}`;
  }
  if (typeof detail.blocked_source_count === "number" && detail.blocked_source_count > 0) {
    return `blocked sources: ${detail.blocked_source_count}`;
  }
  if (typeof detail.invalid_rate === "number" && detail.invalid_rate > 0) {
    const max = typeof detail.max_invalid_rate === "number" ? ` / max ${Math.round(detail.max_invalid_rate * 100)}%` : "";
    return `broken links: ${Math.round(detail.invalid_rate * 100)}%${max}`;
  }
  if (typeof detail.short_source_count === "number" && detail.short_source_count > 0) {
    const minimum = typeof detail.minimum_per_source === "number" ? ` / min ${detail.minimum_per_source}` : "";
    return `short sources: ${detail.short_source_count}${minimum}`;
  }
  if (typeof detail.source_count === "number" && typeof detail.minimum_per_source === "number") {
    return `${detail.source_count} sources / min ${detail.minimum_per_source}`;
  }
  if (typeof detail.distinct_host_count === "number") return `${detail.distinct_host_count} hosts`;
  if (typeof detail.configured === "boolean") return detail.configured ? "configured" : "not configured";
  if (Array.isArray(detail.missing) && detail.missing.length > 0) {
    const envNames = detail.missing
      .map((item) => {
        if (typeof item !== "object" || item === null || !("env_name" in item)) return "";
        const reason = "reason" in item && typeof item.reason === "string" ? ` (${item.reason})` : "";
        return `${String(item.env_name)}${reason}`;
      })
      .filter(Boolean);
    return envNames.length > 0 ? `secret: ${envNames.join(", ")}` : "";
  }
  if (typeof detail.reason === "string") return detail.reason;
  if (typeof detail.success_rate === "number") {
    const jobs = typeof detail.total_jobs === "number" ? ` / ${detail.total_jobs} jobs` : "";
    return `${Math.round(detail.success_rate * 100)}%${jobs}`;
  }
  if (typeof detail.age_hours === "number") return `${detail.age_hours}h old`;
  return "";
}

export const dynamic = "force-dynamic";

export default async function ServiceReadinessPage() {
  const snapshot = redactServiceReadinessSnapshot(await getServiceReadinessSnapshot());
  const failedAxes = snapshot.axes.filter((axis) => axis.status === "fail");
  const blockers = [...new Set(snapshot.launch_blockers)];
  const operatorActions = snapshot.operator_actions;

  return (
    <main className="service-page">
      <section className={`service-hero ${statusClass(snapshot.status)}`}>
        <div>
          <p className="section-kicker">Service Readiness</p>
          <h1>서비스 출시 상태</h1>
          <p className="service-hero-copy">
            실제 데이터 공급, 예약 전환, 운영 감시, 사용자 고지, 런칭 운영 gate를 한 곳에서 확인합니다.
          </p>
        </div>
        <div className="service-score">
          <span>{statusLabel(snapshot.status)}</span>
          <strong>{snapshot.summary.passed}/{snapshot.summary.checks_total}</strong>
          <small>{formatStamp(snapshot.generated_at)}</small>
        </div>
      </section>

      <section className="service-summary-grid">
        <article className="service-summary-card">
          <span>Passed</span>
          <strong>{snapshot.summary.passed}</strong>
        </article>
        <article className="service-summary-card">
          <span>Warnings</span>
          <strong>{snapshot.summary.warned}</strong>
        </article>
        <article className="service-summary-card">
          <span>Blockers</span>
          <strong>{snapshot.summary.failed}</strong>
        </article>
        <article className="service-summary-card">
          <span>Blocked axes</span>
          <strong>{failedAxes.length}</strong>
        </article>
      </section>

      {blockers.length > 0 && (
        <section className="service-blockers">
          <div>
            <p className="section-kicker">Launch Blockers</p>
            <h2>서비스 사용 전 필요한 조치</h2>
          </div>
          <div className="service-blocker-list">
            {blockers.map((blocker) => (
              <span key={blocker}>{blocker}</span>
            ))}
          </div>
        </section>
      )}

      {operatorActions.length > 0 && (
        <section className="service-actions">
          <div className="service-actions-head">
            <p className="section-kicker">Action Queue</p>
            <h2>다음 운영 조치</h2>
          </div>
          <div className="service-action-list">
            {operatorActions.map((item) => (
              <article key={item.check} className="service-action">
                <span>{item.priority}. {item.phase} · {item.area}</span>
                <strong>{item.action}</strong>
                <small>{item.verify}</small>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="service-axis-grid">
        {snapshot.axes.map((axis) => (
          <article key={axis.id} className={`service-axis-card ${statusClass(axis.status)}`}>
            <div className="service-axis-head">
              <div>
                <span>{statusLabel(axis.status)}</span>
                <h2>{axis.label}</h2>
              </div>
              <strong>{axis.checks.filter((check) => check.status === "pass").length}/{axis.checks.length}</strong>
            </div>
            <div className="service-check-list">
              {axis.checks.map((check) => (
                <div key={check.name} className={`service-check ${statusClass(check.status)}`}>
                  <span>
                    {CHECK_LABELS[check.name] ?? check.name}
                    {formatDetail(check.detail) && <small>{formatDetail(check.detail)}</small>}
                  </span>
                  <strong>{statusLabel(check.status)}</strong>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="service-links">
        <Link href="/map" className="cta-link">특가 지도</Link>
        <Link href="/policies" className="cta-link service-secondary-link">정책 보기</Link>
        <a href="/api/ops/service-readiness" className="cta-link service-secondary-link">JSON 상태</a>
      </section>
    </main>
  );
}
