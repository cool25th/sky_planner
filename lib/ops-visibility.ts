import type { ServiceAxis, ServiceCheck, ServiceReadinessSnapshot } from "./service-readiness.ts";

export const OPS_READINESS_TOKEN_ENV = "OPS_READINESS_TOKEN";

export type OpsVisibility = "public" | "internal";

export interface OpsRequestVisibility {
  visibility: OpsVisibility;
  token_configured: boolean;
  authenticated: boolean;
}

export type PublicServiceReadinessSnapshot = ServiceReadinessSnapshot & {
  visibility: "public";
  operator_actions: PublicOperatorAction[];
};

export type InternalServiceReadinessSnapshot = ServiceReadinessSnapshot & {
  visibility: "internal";
  operator_actions: InternalOperatorAction[];
};

export interface PublicOperatorAction {
  check: string;
  priority: number;
  phase: string;
  area: string;
  action: string;
  verify: string;
}

export interface InternalOperatorAction {
  check: string;
  priority: number;
  phase: string;
  axis: ServiceAxis["id"];
  axis_label: string;
  status: ServiceCheck["status"];
  action: string;
  verify: string;
  required_env: string[];
  affected_sources: string[];
  reason: string | string[] | null;
}

export interface SourceReadinessOperatorAction {
  area: string;
  action: string;
  verify: string;
  reason: string | null;
  source_id?: string | null;
  required_env?: string[];
  env_flag?: string | null;
  latest_failure_code?: string | null;
}

const SOURCE_HEALTH_SMOKE_INTERNAL_VERIFY = "npm run smoke:source-health -- --database-url [REDACTED_DATABASE_URL]";
const SOURCE_HEALTH_SMOKE_PUBLIC_VERIFY = "source health smoke를 DB URL 지정 후 다시 실행합니다.";

const PLACEHOLDER_TOKEN_VALUES = new Set([
  "replace-me",
  "changeme",
  "change-me",
  "todo",
  "dummy",
  "example",
  "test",
  "secret",
  "your-secret-here",
]);

const SENSITIVE_DETAIL_KEYS = new Set([
  "env_name",
  "env_names",
  "env_names_by_source",
  "error",
  "host",
  "url",
  "endpoint",
  "origin",
  "token_env",
  "artifact",
  "artifact_prefix",
  "last_artifact_prefix",
  "last_error",
]);

const PUBLIC_BLOCKER_MESSAGES: Record<string, string> = {
  postgres_read_model_configured: "운영 데이터베이스 연결 확인이 필요합니다.",
  postgres_read_model_queryable: "운영 데이터 조회 경로 확인이 필요합니다.",
  fresh_successful_batch: "최신 성공 배치 증거가 필요합니다.",
  last_batch_source_coverage: "최신 배치 source coverage 확인이 필요합니다.",
  eligible_sources_minimum: "검색 가능한 승인 source가 더 필요합니다.",
  source_policy_catalog_coverage: "운영 source policy 등록이 필요합니다.",
  live_collector_success: "승인된 live collector 성공 증거가 필요합니다.",
  collector_manifest_configured: "운영 source manifest 설정이 필요합니다.",
  source_credentials_present: "승인 source 접근 설정이 필요합니다.",
  inventory_present: "검색 가능한 재고 적재가 필요합니다.",
  booking_deeplink_sample_present: "예약 링크 샘플 확인이 필요합니다.",
  booking_deeplink_sample_depth: "source별 예약 링크 샘플 수 확인이 필요합니다.",
  booking_deeplink_shape: "예약 링크 형식 확인이 필요합니다.",
  booking_deeplink_source_coverage: "source별 예약 링크 커버리지 확인이 필요합니다.",
  source_health_ready: "수집 source health 복구가 필요합니다.",
  collector_success_rate_7d: "최근 7일 수집 안정성 증거가 필요합니다.",
  alert_channel_configured: "운영 알림 채널 확인이 필요합니다.",
  readiness_api_available: "서비스 상태 API 확인이 필요합니다.",
  ops_readiness_token_configured: "내부 운영 상태 접근 보호가 필요합니다.",
  mock_fallback_disabled: "운영 검색 API의 mock fallback 비활성화가 필요합니다.",
  source_kill_switches_configured: "source kill switch 설정 확인이 필요합니다.",
  source_max_stale_hours_configured: "source freshness 기준 설정이 필요합니다.",
  status_page_available: "서비스 상태 화면 확인이 필요합니다.",
  trust_cues_available: "검색 신뢰 표시 확인이 필요합니다.",
  service_unavailable_ui_available: "데이터 장애 안내 화면 확인이 필요합니다.",
  search_inventory_available: "검색 재고 확인이 필요합니다.",
  support_contact_configured: "고객 문의 채널 확인이 필요합니다.",
  public_policy_page: "정책 페이지 공개가 필요합니다.",
  affiliate_disclosure: "제휴 고지 확인이 필요합니다.",
  data_accuracy_disclosure: "가격 고지 확인이 필요합니다.",
  support_contact_disclosure: "문의와 장애 고지 확인이 필요합니다.",
  ops_runbook_available: "운영 runbook 확인이 필요합니다.",
  env_template_available: "운영 환경 변수 템플릿 확인이 필요합니다.",
  runtime_env_preflight_available: "런타임 환경 gate 확인이 필요합니다.",
  contract_test_gate_available: "서비스 계약 테스트 gate 확인이 필요합니다.",
  production_build_gate_available: "production build gate 확인이 필요합니다.",
  production_manifest_template_available: "운영 manifest 템플릿 확인이 필요합니다.",
  collector_workflow_gate_configured: "수집 workflow gate 확인이 필요합니다.",
  collector_artifact_upload_configured: "수집 증거 artifact 보존 확인이 필요합니다.",
  public_api_503_guard_available: "운영 public API 503 guard 확인이 필요합니다.",
  kill_switch_available: "source kill switch 확인이 필요합니다.",
  production_gate_available: "production readiness gate 확인이 필요합니다.",
  service_gate_available: "service readiness gate 확인이 필요합니다.",
  ops_alert_gate_available: "운영 알림 전달 gate 확인이 필요합니다.",
  service_launch_audit_available: "런칭 audit 증거 저장 확인이 필요합니다.",
};

interface OperatorActionCopy {
  area: string;
  action: string;
  verify: string;
}

interface OperatorActionOrder {
  priority: number;
  phase: string;
}

const OPERATOR_ACTION_ORDER: Record<string, OperatorActionOrder> = {
  postgres_read_model_configured: { priority: 10, phase: "런타임/DB" },
  postgres_read_model_queryable: { priority: 11, phase: "런타임/DB" },
  mock_fallback_disabled: { priority: 12, phase: "런타임/DB" },
  source_kill_switches_configured: { priority: 13, phase: "런타임/DB" },
  source_max_stale_hours_configured: { priority: 14, phase: "런타임/DB" },
  support_contact_configured: { priority: 15, phase: "런타임/DB" },
  alert_channel_configured: { priority: 16, phase: "런타임/DB" },
  ops_readiness_token_configured: { priority: 17, phase: "런타임/DB" },

  collector_manifest_configured: { priority: 20, phase: "Source 설정" },
  source_credentials_present: { priority: 21, phase: "Source 설정" },
  source_policy_catalog_coverage: { priority: 22, phase: "Source 설정" },

  fresh_successful_batch: { priority: 30, phase: "Collector 증거" },
  last_batch_source_coverage: { priority: 31, phase: "Collector 증거" },
  live_collector_success: { priority: 32, phase: "Collector 증거" },
  source_health_ready: { priority: 33, phase: "Collector 증거" },
  collector_success_rate_7d: { priority: 34, phase: "Collector 증거" },
  eligible_sources_minimum: { priority: 35, phase: "Collector 증거" },
  inventory_present: { priority: 36, phase: "Collector 증거" },
  search_inventory_available: { priority: 37, phase: "Collector 증거" },

  booking_deeplink_sample_present: { priority: 40, phase: "예약 전환" },
  booking_deeplink_sample_depth: { priority: 41, phase: "예약 전환" },
  booking_deeplink_shape: { priority: 42, phase: "예약 전환" },
  booking_deeplink_source_coverage: { priority: 43, phase: "예약 전환" },

  public_api_503_guard_available: { priority: 50, phase: "Launch gate" },
  contract_test_gate_available: { priority: 51, phase: "Launch gate" },
  production_build_gate_available: { priority: 52, phase: "Launch gate" },
  ops_alert_gate_available: { priority: 53, phase: "Launch gate" },
  service_launch_audit_available: { priority: 54, phase: "Launch gate" },
};

function operatorActionOrder(checkName: string): OperatorActionOrder {
  return OPERATOR_ACTION_ORDER[checkName] ?? { priority: 900, phase: "서비스 점검" };
}

function orderOperatorActions<T extends { check: string; priority: number }>(actions: T[]): T[] {
  return [...actions].sort((left, right) => (
    left.priority - right.priority || left.check.localeCompare(right.check)
  ));
}

const PUBLIC_OPERATOR_ACTIONS: Record<string, OperatorActionCopy> = {
  postgres_read_model_configured: {
    area: "데이터 공급",
    action: "운영 read model 연결을 배포 환경에 연결합니다.",
    verify: "runtime env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  postgres_read_model_queryable: {
    area: "데이터 공급",
    action: "운영 read model 연결, 권한, schema 상태를 복구합니다.",
    verify: "service readiness smoke에서 DB 조회 가능 상태를 확인합니다.",
  },
  fresh_successful_batch: {
    area: "데이터 공급",
    action: "승인 source 수집 배치를 다시 실행해 최신 성공 배치를 남깁니다.",
    verify: "collector 포함 launch audit를 다시 실행합니다.",
  },
  last_batch_source_coverage: {
    area: "데이터 공급",
    action: "최신 collector run이 활성 source 전체를 포함하도록 다시 실행합니다.",
    verify: "collector 포함 launch audit와 service readiness smoke를 다시 실행합니다.",
  },
  eligible_sources_minimum: {
    area: "데이터 공급",
    action: "검색 가능한 승인 source를 2개 이상 확보합니다.",
    verify: "source health와 service readiness smoke를 다시 확인합니다.",
  },
  source_policy_catalog_coverage: {
    area: "수집 설정",
    action: "운영 manifest의 source_id를 source policy catalog에 등록합니다.",
    verify: "service env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  live_collector_success: {
    area: "수집 증거",
    action: "local mock이 아닌 승인 feed collector 성공 이력과 artifact ref를 남깁니다.",
    verify: "collector 포함 launch audit를 다시 실행합니다.",
  },
  collector_manifest_configured: {
    area: "수집 설정",
    action: "운영 source manifest를 실제 partner endpoint와 artifact 보존 경로 기준으로 주입합니다.",
    verify: "service env preflight를 다시 실행합니다.",
  },
  source_credentials_present: {
    area: "수집 설정",
    action: "활성 source 접근 secret을 16자 이상의 비-placeholder 값으로 주입합니다.",
    verify: "service env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  inventory_present: {
    area: "데이터 공급",
    action: "활성 offer와 현재 deal 재고를 운영 read model에 적재합니다.",
    verify: "service readiness smoke에서 활성 재고를 확인합니다.",
  },
  booking_deeplink_sample_present: {
    area: "예약 전환",
    action: "활성 offer의 예약 링크 샘플을 확보합니다.",
    verify: "service readiness smoke에서 예약 링크 샘플을 확인합니다.",
  },
  booking_deeplink_sample_depth: {
    area: "예약 전환",
    action: "활성 source마다 유효한 예약 링크 샘플을 최소 5건씩 확보합니다.",
    verify: "service readiness smoke에서 source별 예약 링크 샘플 수를 확인합니다.",
  },
  booking_deeplink_shape: {
    area: "예약 전환",
    action: "예약 링크를 HTTPS 운영 host로 정규화합니다.",
    verify: "production readiness와 service readiness smoke를 다시 실행합니다.",
  },
  booking_deeplink_source_coverage: {
    area: "예약 전환",
    action: "활성 source마다 예약 링크 샘플이 적재되도록 collector mapping을 보완합니다.",
    verify: "service readiness smoke에서 source별 링크 커버리지를 확인합니다.",
  },
  source_health_ready: {
    area: "운영 모니터링",
    action: "stale, paused, circuit-open source 상태를 해소합니다.",
    verify: "source health smoke를 다시 실행합니다.",
  },
  collector_success_rate_7d: {
    area: "운영 모니터링",
    action: "최근 7일 동안 활성 source별 live collector 성공 이력을 확보합니다.",
    verify: "collector 포함 launch audit와 service readiness smoke를 다시 실행합니다.",
  },
  alert_channel_configured: {
    area: "운영 모니터링",
    action: "실제 운영 알림 채널을 설정하고 전송을 확인합니다.",
    verify: "ops alert smoke를 다시 실행합니다.",
  },
  ops_readiness_token_configured: {
    area: "운영 모니터링",
    action: "내부 운영 상태 JSON 접근 보호 토큰을 설정합니다.",
    verify: "runtime env preflight를 다시 실행합니다.",
  },
  search_inventory_available: {
    area: "사용자 경험",
    action: "사용자 검색에 노출 가능한 활성 deal 재고를 확보합니다.",
    verify: "service readiness smoke에서 검색 재고를 확인합니다.",
  },
  support_contact_configured: {
    area: "사용자 경험",
    action: "실제 수신 가능한 고객 문의 채널을 설정합니다.",
    verify: "runtime env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  mock_fallback_disabled: {
    area: "런칭 운영",
    action: "운영 API가 mock fallback을 사용하지 않도록 배포 설정을 고정합니다.",
    verify: "runtime env preflight와 public API 503 fallback 동작을 확인합니다.",
  },
  source_kill_switches_configured: {
    area: "런칭 운영",
    action: "source별 kill switch를 모두 명시적인 true/false 값으로 설정합니다.",
    verify: "runtime env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  source_max_stale_hours_configured: {
    area: "런칭 운영",
    action: "source freshness 기준을 양의 정수 시간 값으로 설정합니다.",
    verify: "runtime env preflight와 service readiness smoke를 다시 실행합니다.",
  },
  public_api_503_guard_available: {
    area: "런칭 운영",
    action: "검색/지도/캘린더/오퍼 API가 read model 장애 시 mock 데이터 대신 503/no-store를 반환하도록 guard를 유지합니다.",
    verify: "service readiness smoke와 public API 503 fallback 계약 테스트를 다시 실행합니다.",
  },
  production_build_gate_available: {
    area: "런칭 운영",
    action: "Next production build가 launch audit release gate 증거에 포함되도록 유지합니다.",
    verify: "npm run build와 service launch audit dry-run을 다시 실행합니다.",
  },
  contract_test_gate_available: {
    area: "런칭 운영",
    action: "JS 계약 테스트와 Python backend 테스트가 launch audit release gate 증거에 포함되도록 유지합니다.",
    verify: "npm test, python3 unittest, service launch audit dry-run을 다시 실행합니다.",
  },
};

const INTERNAL_OPERATOR_GUIDANCE: Record<string, { action: string; verify: string }> = {
  postgres_read_model_configured: {
    action: "DATABASE_URL을 운영 PostgreSQL read model로 설정합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  postgres_read_model_queryable: {
    action: "DATABASE_URL, DB 권한, read model schema 상태를 복구합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  fresh_successful_batch: {
    action: "승인 source collector batch를 실행해 성공 batch와 최신 last_batch를 남깁니다.",
    verify: "npm run audit:service-launch -- --verify-release-gates --run-collector --output-dir runtime/service-launch-audits",
  },
  last_batch_source_coverage: {
    action: "collector:sources run 단위 last_batch.source_flags가 manifest active source 전체를 포함하도록 배치를 다시 실행합니다.",
    verify: "npm run audit:service-launch -- --verify-release-gates --run-collector --continue-on-failure --output-dir runtime/service-launch-audits",
  },
  eligible_sources_minimum: {
    action: "운영 manifest와 source health 기준으로 검색 가능한 승인 source를 2개 이상 확보합니다.",
    verify: `${SOURCE_HEALTH_SMOKE_INTERNAL_VERIFY} && npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON`,
  },
  source_policy_catalog_coverage: {
    action: "manifest source_id에 대응하는 SOURCE_POLICY_CATALOG 항목과 booking_source_keys를 추가합니다.",
    verify: "npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON && npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  live_collector_success: {
    action: "활성 source마다 non-mock parser_version과 collector-artifacts ref가 있는 성공 source_jobs를 남깁니다.",
    verify: "npm run audit:service-launch -- --verify-release-gates --run-collector --output-dir runtime/service-launch-audits",
  },
  collector_manifest_configured: {
    action: "COLLECTOR_SOURCE_MANIFEST_JSON에 운영 partner endpoint, auth token env, artifact root를 설정합니다.",
    verify: "npm run preflight:service-env",
  },
  source_credentials_present: {
    action: "manifest의 auth.token_env가 가리키는 source API secret을 16자 이상의 비-placeholder 값으로 설정합니다.",
    verify: "npm run preflight:service-env",
  },
  inventory_present: {
    action: "활성 offers와 deals_current를 운영 read model에 적재합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  booking_deeplink_sample_present: {
    action: "활성 offer마다 예약 deeplink 샘플이 적재되도록 collector mapping을 복구합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  booking_deeplink_sample_depth: {
    action: "활성 source마다 유효한 예약 deeplink 샘플이 최소 5건 이상 남도록 collector mapping과 source coverage를 보완합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  booking_deeplink_shape: {
    action: "예약 deeplink를 HTTPS 운영 host로 정규화하고 localhost/example/test host를 제거합니다.",
    verify: "npm run smoke:prod-readiness && npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  booking_deeplink_source_coverage: {
    action: "활성 source별 예약 deeplink 샘플을 확보합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  source_health_ready: {
    action: "source_health의 stale, paused, circuit-open 상태를 해소합니다.",
    verify: SOURCE_HEALTH_SMOKE_INTERNAL_VERIFY,
  },
  collector_success_rate_7d: {
    action: "최근 7일 활성 source별 live collector 성공 이력과 95% 이상 성공률을 확보합니다.",
    verify: "npm run audit:service-launch -- --verify-release-gates --run-collector --output-dir runtime/service-launch-audits",
  },
  alert_channel_configured: {
    action: "OPS_ALERT_WEBHOOK_URL을 실제 HTTPS 운영 webhook으로 설정합니다.",
    verify: "npm run smoke:ops-alert",
  },
  ops_readiness_token_configured: {
    action: "OPS_READINESS_TOKEN을 16자 이상의 비-placeholder 값으로 설정합니다.",
    verify: "npm run preflight:runtime-env",
  },
  search_inventory_available: {
    action: "사용자 검색에 노출 가능한 활성 deals_current 재고를 확보합니다.",
    verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
  },
  support_contact_configured: {
    action: "실제 수신 가능한 support email을 설정합니다.",
    verify: "npm run preflight:runtime-env",
  },
  mock_fallback_disabled: {
    action: "SERVICE_REQUIRE_POSTGRES=true로 운영 API mock fallback을 차단합니다.",
    verify: "npm run preflight:runtime-env",
  },
  source_kill_switches_configured: {
    action: "SOURCE_*_ENABLED kill switch 값을 모두 true 또는 false로 명시합니다.",
    verify: "npm run preflight:runtime-env",
  },
  source_max_stale_hours_configured: {
    action: "SOURCE_MAX_STALE_HOURS를 양의 정수 시간 값으로 설정합니다.",
    verify: "npm run preflight:runtime-env",
  },
  public_api_503_guard_available: {
    action: "app/api/search, deals/map, deals/calendar, offers route가 apiStatusForResponse/apiHeadersForResponse를 유지하고 data-source가 suppressMockFallback을 사용하도록 복구합니다.",
    verify: "npm run test:service-readiness && npm run test:service-mode",
  },
  production_build_gate_available: {
    action: "collect-fares workflow의 audit:service-launch 실행에 --verify-release-gates를 복구하고 service-launch-audit production_build step이 npm run build를 실행하도록 유지합니다.",
    verify: "npm run build && npm run audit:service-launch -- --dry-run --verify-release-gates",
  },
  contract_test_gate_available: {
    action: "collect-fares workflow의 audit:service-launch 실행에 --verify-release-gates를 복구하고 service-launch-audit release gate가 npm test와 python3 unittest를 실행하도록 유지합니다.",
    verify: "npm test && python3 -m unittest discover -s tests && npm run audit:service-launch -- --dry-run --verify-release-gates",
  },
};

const STATIC_REQUIRED_ENV_BY_CHECK: Record<string, string[]> = {
  postgres_read_model_configured: ["DATABASE_URL"],
  postgres_read_model_queryable: ["DATABASE_URL"],
  fresh_successful_batch: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
  last_batch_source_coverage: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
  eligible_sources_minimum: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON"],
  source_policy_catalog_coverage: ["COLLECTOR_SOURCE_MANIFEST_JSON"],
  live_collector_success: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
  collector_manifest_configured: ["COLLECTOR_SOURCE_MANIFEST_JSON"],
  source_credentials_present: ["source token_env secrets referenced by manifest"],
  inventory_present: ["DATABASE_URL"],
  booking_deeplink_sample_present: ["DATABASE_URL"],
  booking_deeplink_sample_depth: ["DATABASE_URL"],
  booking_deeplink_shape: ["DATABASE_URL"],
  booking_deeplink_source_coverage: ["DATABASE_URL"],
  source_health_ready: ["DATABASE_URL"],
  collector_success_rate_7d: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
  alert_channel_configured: ["OPS_ALERT_WEBHOOK_URL"],
  ops_readiness_token_configured: [OPS_READINESS_TOKEN_ENV],
  search_inventory_available: ["DATABASE_URL"],
  support_contact_configured: ["SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_EMAIL"],
  mock_fallback_disabled: ["SERVICE_REQUIRE_POSTGRES"],
  source_kill_switches_configured: [
    "SOURCE_SKYSCANNER_ENABLED",
    "SOURCE_KOREAN_AIR_ENABLED",
    "SOURCE_ASIANA_ENABLED",
    "SOURCE_GOOGLE_FLIGHTS_ENABLED",
    "SOURCE_KAYAK_ENABLED",
    "SOURCE_PROMO_PAGES_ENABLED",
  ],
  source_max_stale_hours_configured: ["SOURCE_MAX_STALE_HOURS"],
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayCount(value: unknown) {
  return asArray(value).length;
}

function uniqueReasons(items: unknown) {
  return [...new Set(asArray(items)
    .map((item) => asRecord(item).reason)
    .filter((reason): reason is string => typeof reason === "string" && reason.length > 0))].sort();
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))].sort();
}

function envNamesFromDetailValue(value: unknown) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === "object" && value !== null) {
    return uniqueStrings(Object.values(value).flatMap((item) => asArray(item)));
  }
  return [];
}

function sourceIdsFromDetailValue(value: unknown) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => {
      if (typeof item === "string") return [item];
      const record = asRecord(item);
      return typeof record.source_id === "string" ? [record.source_id] : [];
    }));
  }
  return [];
}

export function opsReadinessTokenFailure(env: Record<string, string | undefined> = process.env) {
  const value = env[OPS_READINESS_TOKEN_ENV];
  if (!value) return "missing";
  const trimmed = String(value).trim();
  if (trimmed.length < 16) return "too_short";
  const normalized = trimmed.toLowerCase();
  if (PLACEHOLDER_TOKEN_VALUES.has(normalized) || normalized.includes("replace-me")) {
    return "placeholder_value";
  }
  return null;
}

function requestToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return request.headers.get("x-ops-readiness-token")?.trim() ?? "";
}

export function resolveOpsRequestVisibility(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): OpsRequestVisibility {
  const tokenFailure = opsReadinessTokenFailure(env);
  if (tokenFailure) {
    return {
      visibility: "public",
      token_configured: false,
      authenticated: false,
    };
  }

  const configuredToken = String(env[OPS_READINESS_TOKEN_ENV]).trim();
  const authenticated = requestToken(request) === configuredToken;
  return {
    visibility: authenticated ? "internal" : "public",
    token_configured: true,
    authenticated,
  };
}

export function opsJsonHeaders(visibility: OpsVisibility) {
  return {
    "Cache-Control": "no-store",
    "X-Ops-Visibility": visibility,
  };
}

export function sourceHealthUnavailablePayload(
  visibility: OpsVisibility,
  options: {
    generatedAt?: string;
    reason?: string;
    error?: string | null;
  } = {},
) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (visibility === "internal") {
    return {
      status: "not_ready",
      generated_at: generatedAt,
      error: options.reason ?? "source_health_unavailable",
      detail: options.error ?? null,
      visibility,
      operator_actions: [{
        area: "source health",
        action: "collector source health 조회 경로를 복구합니다.",
        verify: options.reason === "database_url_missing" ? "npm run preflight:runtime-env" : SOURCE_HEALTH_SMOKE_INTERNAL_VERIFY,
        reason: options.reason ?? "source_health_unavailable",
        required_env: ["DATABASE_URL"],
      }],
    };
  }
  return {
    status: "not_ready",
    generated_at: generatedAt,
    message: "collector source health is unavailable.",
    visibility,
    operator_actions: [{
      area: "source health",
      action: "collector source health 확인이 필요합니다.",
      verify: options.reason === "database_url_missing"
        ? "runtime env preflight를 다시 실행합니다."
        : "source health smoke를 다시 실행합니다.",
      reason: "source_health_unavailable",
    }],
  };
}

function sanitizeGenericDetail(detail: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(detail).flatMap(([key, value]) => {
    if (SENSITIVE_DETAIL_KEYS.has(key)) return [];
    if (/secret|token|credential|password/i.test(key)) return [];
    if (Array.isArray(value)) return [[`${key}_count`, value.length]];
    if (typeof value === "object" && value !== null) return [];
    return [[key, value]];
  }));
}

function redactServiceCheck(check: ServiceCheck): ServiceCheck {
  const detail = asRecord(check.detail);
  if (!check.detail) return check;

  if (check.name === "source_credentials_present") {
    return {
      ...check,
      detail: {
        requirement_source: detail.requirement_source ?? null,
        source_count: Object.keys(asRecord(detail.env_names_by_source)).length || arrayCount(detail.source_ids),
        missing_count: arrayCount(detail.missing),
        reasons: uniqueReasons(detail.missing),
      },
    };
  }

  if (check.name === "collector_manifest_configured") {
    return {
      ...check,
      detail: {
        configured: check.status === "pass",
        reason: check.status === "pass" ? undefined : detail.reason,
      },
    };
  }

  if (check.name === "ops_readiness_token_configured") {
    return {
      ...check,
      detail: {
        configured: check.status === "pass",
        reason: check.status === "pass" ? undefined : detail.reason,
      },
    };
  }

  if (check.name === "alert_channel_configured" || check.name === "support_contact_configured") {
    return {
      ...check,
      detail: {
        configured: check.status === "pass",
        reason: check.status === "pass" ? undefined : detail.reason,
      },
    };
  }

  if (check.name === "postgres_read_model_queryable" && detail.error) {
    return { ...check, detail: { reason: "query_failed" } };
  }

  if (check.name === "live_collector_success") {
    return {
      ...check,
      detail: {
        reason: detail.reason,
        live_source_count: arrayCount(detail.live_source_ids),
        missing_source_count: arrayCount(detail.missing_source_ids),
      },
    };
  }

  if (check.name === "booking_deeplink_shape") {
    return {
      ...check,
      detail: {
        invalid_count: detail.invalid_count ?? 0,
        invalid_rate: detail.invalid_rate ?? null,
        max_invalid_rate: detail.max_invalid_rate ?? null,
        distinct_host_count: arrayCount(detail.distinct_hosts),
      },
    };
  }

  if (check.name === "booking_deeplink_sample_depth") {
    return {
      ...check,
      detail: {
        reason: detail.reason,
        minimum_per_source: detail.minimum_per_source,
        source_count: Object.keys(asRecord(detail.valid_count_by_source)).length,
        short_source_count: arrayCount(detail.short_source_ids),
      },
    };
  }

  if (check.name === "booking_deeplink_source_coverage") {
    return {
      ...check,
      detail: {
        required_source_count: arrayCount(detail.required_source_ids),
        linked_source_count: arrayCount(detail.source_ids_with_links),
        missing_source_count: arrayCount(detail.missing_source_ids),
      },
    };
  }

  if (check.name === "source_health_ready") {
    return {
      ...check,
      detail: {
        status: detail.status,
        source_count: arrayCount(detail.source_flags),
        blocked_source_count: arrayCount(detail.blocked_source_ids),
        blocker_count: arrayCount(detail.readiness_blockers),
        reason_count: arrayCount(detail.source_block_reasons),
      },
    };
  }

  if (check.name === "collector_success_rate_7d") {
    return {
      ...check,
      detail: {
        reason: detail.reason,
        window_days: detail.window_days,
        success_rate: detail.success_rate,
        minimum_success_rate: detail.minimum_success_rate,
        total_jobs: detail.total_jobs,
        success_count: detail.success_count,
        failure_count: detail.failure_count,
        live_success_count: detail.live_success_count,
        missing_live_source_count: arrayCount(detail.missing_live_source_ids),
      },
    };
  }

  return { ...check, detail: sanitizeGenericDetail(detail) };
}

function publicOperatorActions(axes: ServiceAxis[]): PublicOperatorAction[] {
  const failedChecks = axes
    .flatMap((axis) => axis.checks)
    .filter((check) => check.status !== "pass")
    .map((check) => check.name);
  return orderOperatorActions([...new Set(failedChecks)].map((check) => {
    const action = PUBLIC_OPERATOR_ACTIONS[check] ?? {
      area: "서비스 준비",
      action: PUBLIC_BLOCKER_MESSAGES[check] ?? "서비스 준비 항목을 복구합니다.",
      verify: "service readiness smoke를 다시 실행합니다.",
    };
    const order = operatorActionOrder(check);
    return {
      check,
      ...order,
      ...action,
    };
  }));
}

function internalRequiredEnv(check: ServiceCheck) {
  const detail = asRecord(check.detail);
  const dynamicEnvNames = uniqueStrings([
    ...envNamesFromDetailValue(detail.env_name),
    ...envNamesFromDetailValue(detail.env_names),
    ...envNamesFromDetailValue(detail.manifest_env),
    ...envNamesFromDetailValue(detail.env_names_by_source),
    ...asArray(detail.missing).flatMap((item) => envNamesFromDetailValue(asRecord(item).env_name)),
  ]);
  return uniqueStrings([
    ...dynamicEnvNames,
    ...(dynamicEnvNames.length === 0 ? STATIC_REQUIRED_ENV_BY_CHECK[check.name] ?? [] : []),
  ]);
}

function internalAffectedSources(check: ServiceCheck) {
  const detail = asRecord(check.detail);
  return uniqueStrings([
    ...Object.keys(asRecord(detail.env_names_by_source)),
    ...sourceIdsFromDetailValue(detail.source_ids),
    ...sourceIdsFromDetailValue(detail.live_source_ids),
    ...sourceIdsFromDetailValue(detail.missing_source_ids),
    ...sourceIdsFromDetailValue(detail.missing_live_source_ids),
    ...sourceIdsFromDetailValue(detail.unknown_source_ids),
    ...sourceIdsFromDetailValue(detail.required_source_ids),
    ...sourceIdsFromDetailValue(detail.source_ids_with_links),
    ...sourceIdsFromDetailValue(detail.short_source_ids),
    ...sourceIdsFromDetailValue(detail.blocked_source_ids),
    ...sourceIdsFromDetailValue(detail.missing),
  ]);
}

function internalReason(check: ServiceCheck) {
  const detail = asRecord(check.detail);
  if (typeof detail.reason === "string" && detail.reason.length > 0) return detail.reason;
  const reasons = uniqueReasons(detail.missing);
  const sourceHealthReasons = uniqueReasons(detail.source_block_reasons);
  const readinessBlockers = uniqueStrings(asArray(detail.readiness_blockers));
  if (sourceHealthReasons.length > 0 || readinessBlockers.length > 0) {
    return [...new Set([...readinessBlockers, ...sourceHealthReasons])].sort();
  }
  return reasons.length > 0 ? reasons : null;
}

function internalOperatorActions(axes: ServiceAxis[]): InternalOperatorAction[] {
  const seen = new Set<string>();
  const actions: InternalOperatorAction[] = [];
  for (const axis of axes) {
    for (const check of axis.checks) {
      if (check.status === "pass" || seen.has(check.name)) continue;
      seen.add(check.name);
      const publicGuidance = PUBLIC_OPERATOR_ACTIONS[check.name];
      const guidance = INTERNAL_OPERATOR_GUIDANCE[check.name] ?? {
        action: publicGuidance?.action ?? defaultInternalAction(check.name),
        verify: publicGuidance?.verify ?? "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
      };
      const order = operatorActionOrder(check.name);
      actions.push({
        check: check.name,
        ...order,
        axis: axis.id,
        axis_label: axis.label,
        status: check.status,
        action: guidance.action,
        verify: guidance.verify,
        required_env: internalRequiredEnv(check),
        affected_sources: internalAffectedSources(check),
        reason: internalReason(check),
      });
    }
  }
  return orderOperatorActions(actions);
}

function defaultInternalAction(checkName: string) {
  return PUBLIC_BLOCKER_MESSAGES[checkName] ?? "서비스 준비 항목을 복구합니다.";
}

export function enrichInternalServiceReadinessSnapshot(snapshot: ServiceReadinessSnapshot): InternalServiceReadinessSnapshot {
  return {
    ...snapshot,
    visibility: "internal",
    operator_actions: internalOperatorActions(snapshot.axes),
  };
}

export function redactServiceReadinessSnapshot(snapshot: ServiceReadinessSnapshot): PublicServiceReadinessSnapshot {
  const axes: ServiceAxis[] = snapshot.axes.map((axis) => {
    const checks = axis.checks.map(redactServiceCheck);
    return {
      ...axis,
      checks,
      next_actions: [...new Set(checks
        .filter((check) => check.status !== "pass")
        .map((check) => PUBLIC_BLOCKER_MESSAGES[check.name] ?? "서비스 준비 항목 확인이 필요합니다."))],
    };
  });
  const launchBlockers = [...new Set(axes
    .flatMap((axis) => axis.checks)
    .filter((check) => check.status !== "pass")
    .map((check) => PUBLIC_BLOCKER_MESSAGES[check.name] ?? "서비스 준비 항목 확인이 필요합니다."))];

  return {
    ...snapshot,
    visibility: "public",
    launch_blockers: launchBlockers,
    operator_actions: publicOperatorActions(axes),
    axes,
  };
}

function safeLastBatch(lastBatch: Record<string, unknown>) {
  return {
    status: lastBatch.status ?? null,
    last_batch_at: lastBatch.last_batch_at ?? lastBatch.lastBatchAt ?? null,
  };
}

function safeSource(source: Record<string, unknown>) {
  const health = asRecord(source.health);
  const latestJob = asRecord(source.latest_job);
  return {
    source_id: source.source_id ?? null,
    env_enabled: source.env_enabled ?? false,
    search_eligible: source.search_eligible ?? false,
    block_reason: source.block_reason ?? null,
    default_enabled: source.default_enabled ?? false,
    health: source.health ? {
      is_paused: health.is_paused ?? false,
      enabled_by_flag: health.enabled_by_flag ?? false,
      circuit_breaker_open: health.circuit_breaker_open ?? false,
      consecutive_failures: health.consecutive_failures ?? 0,
      last_success_at: health.last_success_at ?? null,
      last_failure_at: health.last_failure_at ?? null,
      last_failure_code: health.last_failure_code ?? null,
      last_checked_at: health.last_checked_at ?? null,
      stats_24h: health.stats_24h ?? null,
    } : null,
    latest_job: source.latest_job ? {
      status: latestJob.status ?? null,
      parser_version: latestJob.parser_version ?? null,
      offers_found: latestJob.offers_found ?? 0,
      offers_changed: latestJob.offers_changed ?? 0,
      snapshots_written: latestJob.snapshots_written ?? 0,
      deals_recomputed: latestJob.deals_recomputed ?? 0,
      failure_code: latestJob.failure_code ?? null,
      completed_at: latestJob.completed_at ?? null,
      created_at: latestJob.created_at ?? null,
    } : null,
  };
}

function sourceReadinessOperatorActions(
  snapshot: Record<string, unknown>,
  visibility: OpsVisibility,
): SourceReadinessOperatorAction[] {
  const actions: SourceReadinessOperatorAction[] = [];
  const counts = asRecord(snapshot.counts);
  const lastBatch = asRecord(snapshot.last_batch);
  const sources = asArray(snapshot.sources).map((source) => asRecord(source));
  const readinessBlockers = uniqueStrings(asArray(snapshot.readiness_blockers));
  const includeInternal = visibility === "internal";
  const searchEligibleCount = Number(counts.search_eligible_sources ?? 0);
  const minimumSearchEligibleCount = Number(counts.minimum_search_eligible_sources ?? 1);

  if (readinessBlockers.includes("source_kill_switches_invalid")) {
    actions.push({
      area: "source policy",
      action: "source별 kill switch를 모두 명시적인 true/false 값으로 설정합니다.",
      verify: includeInternal ? "npm run preflight:runtime-env" : "runtime env preflight를 다시 실행합니다.",
      reason: "source_kill_switches_invalid",
      ...(includeInternal ? {
        required_env: [
          "SOURCE_SKYSCANNER_ENABLED",
          "SOURCE_KOREAN_AIR_ENABLED",
          "SOURCE_ASIANA_ENABLED",
          "SOURCE_GOOGLE_FLIGHTS_ENABLED",
          "SOURCE_KAYAK_ENABLED",
          "SOURCE_PROMO_PAGES_ENABLED",
        ],
      } : {}),
    });
  }

  if (readinessBlockers.includes("source_max_stale_hours_invalid")) {
    actions.push({
      area: "source policy",
      action: includeInternal
        ? "SOURCE_MAX_STALE_HOURS를 양의 정수 시간 값으로 설정합니다."
        : "source freshness 기준을 양의 정수 시간 값으로 설정합니다.",
      verify: includeInternal ? "npm run preflight:runtime-env" : "runtime env preflight를 다시 실행합니다.",
      reason: "source_max_stale_hours_invalid",
      ...(includeInternal ? { required_env: ["SOURCE_MAX_STALE_HOURS"] } : {}),
    });
  }

  if (lastBatch.status !== "success") {
    actions.push({
      area: "collector batch",
      action: "최신 collector batch를 성공 상태로 복구합니다.",
      verify: "npm run audit:service-launch -- --verify-release-gates --run-collector --continue-on-failure --output-dir runtime/service-launch-audits",
      reason: typeof lastBatch.status === "string" ? `last_batch_${lastBatch.status}` : "last_batch_missing",
      ...(includeInternal ? { required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"] } : {}),
    });
  }

  if (Number(counts.env_enabled_sources ?? 0) === 0) {
    actions.push({
      area: "source policy",
      action: "운영 source kill switch가 모두 꺼져 있지 않은지 확인합니다.",
      verify: sourceHealthSmokeVerify(includeInternal),
      reason: "no_env_enabled_sources",
      ...(includeInternal ? {
        required_env: [
          "DATABASE_URL",
          "SOURCE_SKYSCANNER_ENABLED",
          "SOURCE_KOREAN_AIR_ENABLED",
          "SOURCE_ASIANA_ENABLED",
        ],
      } : {}),
    });
  }

  if (searchEligibleCount < minimumSearchEligibleCount) {
    actions.push({
      area: "source coverage",
      action: `검색 가능한 승인 source를 ${minimumSearchEligibleCount}개 이상 확보합니다.`,
      verify: sourceHealthSmokeVerify(includeInternal),
      reason: "insufficient_search_eligible_sources",
      ...(includeInternal ? {
        required_env: [
          "DATABASE_URL",
          "COLLECTOR_SOURCE_MANIFEST_JSON",
          "source token_env secrets referenced by manifest",
          "SOURCE_SKYSCANNER_ENABLED",
          "SOURCE_KOREAN_AIR_ENABLED",
          "SOURCE_ASIANA_ENABLED",
        ],
      } : {}),
    });
  }

  for (const source of sources) {
    if (source.env_enabled === false || source.search_eligible === true) continue;
    const latestJob = asRecord(source.latest_job);
    const reason = typeof source.block_reason === "string" ? source.block_reason : "not_search_eligible";
    const sourceId = typeof source.source_id === "string" ? source.source_id : null;
    const guidance = sourceHealthActionForReason(reason, includeInternal);
    actions.push({
      area: "source health",
      action: guidance.action,
      verify: guidance.verify,
      reason,
      source_id: sourceId,
      ...(includeInternal ? {
        required_env: guidance.required_env,
        env_flag: typeof source.env_flag === "string" ? source.env_flag : null,
        latest_failure_code: typeof latestJob.failure_code === "string" ? latestJob.failure_code : null,
      } : {}),
    });
  }

  if (actions.length === 0 && snapshot.status !== "ready") {
    actions.push({
      area: "source health",
      action: "source readiness 실패 detail을 확인하고 collector health gate를 복구합니다.",
      verify: sourceHealthSmokeVerify(includeInternal),
      reason: "source_readiness_not_ready",
      ...(includeInternal ? { required_env: ["DATABASE_URL"] } : {}),
    });
  }

  return actions;
}

function sourceHealthSmokeVerify(includeInternal: boolean) {
  return includeInternal ? SOURCE_HEALTH_SMOKE_INTERNAL_VERIFY : SOURCE_HEALTH_SMOKE_PUBLIC_VERIFY;
}

function sourceHealthActionForReason(reason: string, includeInternal: boolean) {
  const runCollector = "npm run audit:service-launch -- --verify-release-gates --run-collector --continue-on-failure --output-dir runtime/service-launch-audits";
  const sourceHealthSmoke = sourceHealthSmokeVerify(includeInternal);
  const catalog: Record<string, { action: string; verify: string; required_env: string[] }> = {
    missing_source_health: {
      action: "해당 source의 source_health row가 생성되도록 collector를 실행합니다.",
      verify: runCollector,
      required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
    },
    never_successful: {
      action: "해당 source의 첫 성공 collector run을 남깁니다.",
      verify: runCollector,
      required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
    },
    stale: {
      action: "해당 source collector를 재실행해 last_success_at을 최신화합니다.",
      verify: runCollector,
      required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
    },
    paused: {
      action: "운영자가 의도한 pause인지 확인하고 source pause 상태를 해제합니다.",
      verify: sourceHealthSmoke,
      required_env: ["DATABASE_URL"],
    },
    disabled_by_health: {
      action: "source health의 enabled_by_flag 상태를 복구합니다.",
      verify: sourceHealthSmoke,
      required_env: ["DATABASE_URL"],
    },
    circuit_breaker_open: {
      action: "최근 실패 원인을 해소한 뒤 circuit breaker를 닫고 collector를 재실행합니다.",
      verify: runCollector,
      required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
    },
    consecutive_failures: {
      action: "연속 실패 원인을 해소하고 성공 collector run을 남깁니다.",
      verify: runCollector,
      required_env: ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "source token_env secrets referenced by manifest"],
    },
  };
  return catalog[reason] ?? {
    action: "해당 source health 상태를 복구합니다.",
    verify: sourceHealthSmoke,
    required_env: ["DATABASE_URL"],
  };
}

export function enrichInternalSourceReadinessSnapshot(snapshot: Record<string, unknown>) {
  return {
    ...snapshot,
    visibility: "internal" as const,
    operator_actions: sourceReadinessOperatorActions(snapshot, "internal"),
  };
}

export function redactSourceReadinessSnapshot(snapshot: Record<string, unknown>) {
  const publicSnapshot = {
    status: snapshot.status ?? "not_ready",
    generated_at: snapshot.generated_at ?? new Date().toISOString(),
    visibility: "public" as const,
    max_stale_hours: snapshot.max_stale_hours ?? null,
    counts: snapshot.counts ?? null,
    readiness_blockers: asArray(snapshot.readiness_blockers),
    source_flags: asArray(snapshot.source_flags),
    blocked_source_ids: asArray(snapshot.blocked_source_ids),
    last_batch: safeLastBatch(asRecord(snapshot.last_batch)),
    sources: asArray(snapshot.sources).map((source) => safeSource(asRecord(source))),
  };
  return {
    ...publicSnapshot,
    operator_actions: sourceReadinessOperatorActions(publicSnapshot, "public"),
  };
}
