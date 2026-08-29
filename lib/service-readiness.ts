import { resolveSupportContact } from "./service-contact.ts";
import type { SourceCredentialRequirements } from "./service-credential-requirements.ts";
import { OPS_READINESS_TOKEN_ENV, opsReadinessTokenFailure } from "./ops-visibility.ts";
import { secretValueFailure } from "./secret-validation.ts";
import { SERVICE_REQUIRE_POSTGRES_ENV, serviceRequirePostgresFailure } from "./service-mode.ts";
import { SOURCE_POLICY_CATALOG, sourceMaxStaleHoursFromEnv } from "./source-policy.ts";
import { MINIMUM_SEARCH_ELIGIBLE_SOURCES } from "./source-readiness.ts";

export type ServiceCheckStatus = "pass" | "warn" | "fail";

export interface ServiceCheck {
  name: string;
  status: ServiceCheckStatus;
  detail?: Record<string, unknown>;
}

export type ServiceAxisId =
  | "data_supply"
  | "booking_conversion"
  | "operations_monitoring"
  | "user_experience"
  | "policy_compliance"
  | "launch_operations";

export interface ServiceAxis {
  id: ServiceAxisId;
  label: string;
  status: ServiceCheckStatus;
  checks: ServiceCheck[];
  next_actions: string[];
}

export interface SourceReadinessForService {
  status?: string;
  source_flags?: string[];
  blocked_source_ids?: string[];
  readiness_blockers?: string[];
  counts?: {
    search_eligible_sources?: number;
    blocked_sources?: number;
    env_enabled_sources?: number;
  };
  sources?: Array<{
    source_id?: string | null;
    env_enabled?: boolean;
    search_eligible?: boolean;
    block_reason?: string | null;
    env_flag?: string | null;
  }>;
}

export interface LatestSourceJobForService {
  source_id?: string | null;
  status?: string | null;
  parser_version?: string | null;
  artifact_prefix?: string | null;
  offers_found?: number | string | null;
  completed_at?: Date | string | null;
  created_at?: Date | string | null;
}

export interface DeepLinkAuditInput {
  sample_size: number;
  invalid_count: number;
  distinct_hosts: string[];
  source_ids_with_links?: string[];
  valid_count_by_source?: Record<string, number>;
}

export interface OperationalHistoryInput {
  window_days: number;
  total_jobs: number;
  success_count: number;
  failure_count: number;
  live_success_count: number;
  success_rate: number | null;
  live_success_source_ids: string[];
}

export interface ServiceReadinessInput {
  env?: Record<string, string | undefined>;
  now?: Date;
  databaseConfigured?: boolean;
  databaseError?: string | null;
  counts?: {
    places?: number;
    offers_active?: number;
    deals_current_active?: number;
    source_health?: number;
  } | null;
  batchState?: Record<string, unknown> | null;
  sourceReadiness?: SourceReadinessForService | null;
  latestJobs?: LatestSourceJobForService[];
  deepLinkAudit?: DeepLinkAuditInput | null;
  operationalHistory?: OperationalHistoryInput | null;
  sourceCredentialRequirements?: SourceCredentialRequirements | null;
  sourceCredentialManifestEnv?: string;
  sourceCredentialManifestConfigured?: boolean;
  sourceCredentialManifestError?: string | null;
  policyArtifacts?: {
    publicPolicyPage?: boolean;
    affiliateDisclosure?: boolean;
    dataAccuracyDisclosure?: boolean;
    supportContactDisclosure?: boolean;
    opsRunbook?: boolean;
    readinessApi?: boolean;
    readinessPage?: boolean;
  };
  userExperienceArtifacts?: {
    trustCues?: boolean;
    serviceUnavailableUi?: boolean;
  };
  launchArtifacts?: {
    opsRunbook?: boolean;
    envTemplate?: boolean;
    runtimeEnvPreflight?: boolean;
    contractTestGate?: boolean;
    productionBuildGate?: boolean;
    productionManifestTemplate?: boolean;
    collectorWorkflow?: boolean;
    collectorArtifactUpload?: boolean;
    publicApiFallbackGuard?: boolean;
    prodReadinessGate?: boolean;
    serviceReadinessGate?: boolean;
    opsAlertGate?: boolean;
    serviceLaunchAudit?: boolean;
  };
}

export interface ServiceReadinessSnapshot {
  status: "ready" | "not_ready";
  generated_at: string;
  summary: {
    checks_total: number;
    passed: number;
    warned: number;
    failed: number;
    failed_checks: string[];
    warning_checks: string[];
  };
  launch_blockers: string[];
  axes: ServiceAxis[];
}

const SOURCE_CREDENTIAL_ENVS: Record<string, string[]> = {
  skyscanner_affiliate: ["SKYSCANNER_FEED_API_KEY"],
  korean_air_official: ["KOREAN_AIR_FEED_API_KEY"],
  asiana_official: ["ASIANA_FEED_API_KEY"],
};

const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org", "example.test"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const SOURCE_FLAG_TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const SOURCE_FLAG_FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const MIN_DEEPLINK_SAMPLES_PER_SOURCE = 5;
const MAX_BROKEN_DEEPLINK_RATE = 0.05;

const AXIS_LABELS: Record<ServiceAxisId, string> = {
  data_supply: "실제 데이터 공급",
  booking_conversion: "예약 전환 신뢰성",
  operations_monitoring: "운영 모니터링",
  user_experience: "사용자 경험",
  policy_compliance: "서비스 정책",
  launch_operations: "런칭 운영",
};

const NEXT_ACTIONS: Record<string, string> = {
  postgres_read_model_configured: "운영 DATABASE_URL을 연결합니다.",
  postgres_read_model_queryable: "PostgreSQL read model 연결과 권한을 복구합니다.",
  fresh_successful_batch: "승인 source 배치를 다시 실행해 last_batch를 갱신합니다.",
  last_batch_source_coverage: "최신 collector run이 활성 source 전체를 포함하도록 다시 실행합니다.",
  eligible_sources_minimum: "검색 가능한 승인 source를 최소 자격 기준 이상 확보합니다.",
  source_policy_catalog_coverage: "운영 manifest의 source_id를 source policy catalog에 등록합니다.",
  live_collector_success: "local-mock이 아닌 승인 feed collector 성공 이력과 artifact ref를 남깁니다.",
  collector_manifest_configured: "COLLECTOR_SOURCE_MANIFEST_JSON에 실제 운영 source manifest를 주입합니다.",
  source_credentials_present: "활성 source의 placeholder가 아닌 API credential secret을 주입합니다.",
  inventory_present: "활성 offers/deals를 적재합니다.",
  booking_deeplink_sample_present: "활성 offer의 예약 deeplink 샘플을 확보합니다.",
  booking_deeplink_sample_depth: "활성 source별 예약 deeplink 샘플을 5건 이상 확보합니다.",
  booking_deeplink_shape: "예약 deeplink에서 localhost/example/non-HTTPS host를 제거합니다.",
  booking_deeplink_source_coverage: "활성 source별 예약 deeplink 샘플을 확보합니다.",
  source_health_ready: "source_health의 stale/paused/circuit-open 상태를 해소합니다.",
  collector_success_rate_7d: "최근 7일 승인 collector 성공률 95% 이상과 source별 live 성공 이력을 확보합니다.",
  alert_channel_configured: "OPS_ALERT_WEBHOOK_URL을 실제 HTTPS webhook으로 설정합니다.",
  readiness_api_available: "서비스 readiness API를 노출합니다.",
  ops_readiness_token_configured: "내부 ops JSON 접근 토큰으로 상세 상태 접근을 보호합니다.",
  mock_fallback_disabled: "운영 검색 API에서 mock fallback을 비활성화합니다.",
  status_page_available: "서비스 상태 페이지를 노출합니다.",
  trust_cues_available: "검색 결과 화면에 read model/source health/source 표기를 유지합니다.",
  service_unavailable_ui_available: "read model 장애 시 빈 결과 대신 서비스 일시 중단 안내를 표시합니다.",
  support_contact_configured: "SUPPORT_EMAIL 또는 NEXT_PUBLIC_SUPPORT_EMAIL을 실제 수신 가능한 이메일로 설정합니다.",
  public_policy_page: "정책 페이지를 공개합니다.",
  affiliate_disclosure: "제휴 링크/광고성 링크 고지를 공개합니다.",
  data_accuracy_disclosure: "최종 가격과 예약 가능 여부 책임 범위를 고지합니다.",
  support_contact_disclosure: "문의 채널 설정 전 placeholder를 노출하지 않고 장애 문의 기준을 공개합니다.",
  ops_runbook_available: "운영 runbook을 유지합니다.",
  env_template_available: ".env.example에 운영 필수 환경 변수를 유지합니다.",
  runtime_env_preflight_available: "runtime env preflight gate를 CI/운영 점검에 연결합니다.",
  contract_test_gate_available: "서비스 계약 테스트 gate를 CI/운영 점검에 연결합니다.",
  production_build_gate_available: "Next production build gate를 CI/운영 점검에 연결합니다.",
  production_manifest_template_available: "운영 source manifest 템플릿을 유지합니다.",
	  collector_workflow_gate_configured: "수집 workflow에 preflight/alert/readiness gate를 연결합니다.",
	  collector_artifact_upload_configured: "수집 raw/normalized artifact를 CI 실행 증거로 보존합니다.",
	  public_api_503_guard_available: "운영 public API가 read model 장애 시 mock fallback 대신 503/no-store를 반환하도록 guard를 유지합니다.",
	  kill_switch_available: "source별 kill switch 환경변수를 유지합니다.",
  source_kill_switches_configured: "source별 kill switch를 모두 명시적인 true/false 값으로 설정합니다.",
  source_max_stale_hours_configured: "SOURCE_MAX_STALE_HOURS를 양의 정수 시간 값으로 설정합니다.",
	  production_gate_available: "prod-readiness smoke gate를 CI/운영 점검에 연결합니다.",
  service_gate_available: "service-readiness smoke gate를 CI/운영 점검에 연결합니다.",
  ops_alert_gate_available: "ops alert delivery smoke gate를 CI/운영 점검에 연결합니다.",
  service_launch_audit_available: "runtime/source/alert/readiness gate와 cutover 증거 저장을 포함한 launch audit을 유지합니다.",
};

function check(name: string, status: ServiceCheckStatus, detail: Record<string, unknown> = {}): ServiceCheck {
  return { name, status, detail };
}

function axisStatus(checks: ServiceCheck[]): ServiceCheckStatus {
  if (checks.some((item) => item.status === "fail")) return "fail";
  if (checks.some((item) => item.status === "warn")) return "warn";
  return "pass";
}

function axis(id: ServiceAxisId, checks: ServiceCheck[]): ServiceAxis {
  const status = axisStatus(checks);
  return {
    id,
    label: AXIS_LABELS[id],
    status,
    checks,
    next_actions: checks
      .filter((item) => item.status !== "pass")
      .map((item) => NEXT_ACTIONS[item.name])
      .filter((value): value is string => Boolean(value)),
  };
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function successfulBatchCheck(batchState: Record<string, unknown> | null | undefined, now: Date, env: Record<string, string | undefined>) {
  const lastBatchAt = asDate(batchState?.last_batch_at ?? batchState?.lastBatchAt);
  if (batchState?.status !== "success") {
    return check("fresh_successful_batch", "fail", { reason: "last_batch_not_success", batch_status: batchState?.status ?? null });
  }
  if (!lastBatchAt) {
    return check("fresh_successful_batch", "fail", { reason: "missing_last_batch_at" });
  }
  const maxStaleHours = sourceMaxStaleHoursFromEnv(env);
  const ageHours = (now.getTime() - lastBatchAt.getTime()) / 3600000;
  return ageHours <= maxStaleHours
    ? check("fresh_successful_batch", "pass", { last_batch_at: lastBatchAt.toISOString(), age_hours: Number(ageHours.toFixed(2)) })
    : check("fresh_successful_batch", "fail", {
        last_batch_at: lastBatchAt.toISOString(),
        age_hours: Number(ageHours.toFixed(2)),
        max_stale_hours: maxStaleHours,
      });
}

function isLiveArtifactRef(value: string | null | undefined) {
  const artifact = String(value ?? "").trim();
  if (!artifact) return false;
  const normalized = artifact.toLowerCase();
  if (normalized.startsWith("local://") || normalized.startsWith("file://") || normalized.startsWith("test://")) {
    return false;
  }
  return normalized.includes("collector-artifacts/");
}

function isLiveCollectorJob(job: LatestSourceJobForService) {
  const parserVersion = String(job.parser_version ?? "").toLowerCase();
  return (
    job.status === "success" &&
    parserVersion !== "" &&
    !parserVersion.includes("local-mock") &&
    !parserVersion.includes("mock") &&
    isLiveArtifactRef(job.artifact_prefix)
  );
}

function latestJobBySource(jobs: LatestSourceJobForService[]) {
  const entries = new Map<string, LatestSourceJobForService>();
  for (const job of jobs) {
    const sourceId = String(job.source_id ?? "");
    if (!sourceId || entries.has(sourceId)) continue;
    entries.set(sourceId, job);
  }
  return entries;
}

function liveCollectorFailureReason(job: LatestSourceJobForService | undefined) {
  if (!job) return "missing_job";
  if (job.status !== "success") return "latest_job_not_success";
  const parserVersion = String(job.parser_version ?? "").toLowerCase();
  if (!parserVersion) return "missing_parser_version";
  if (parserVersion.includes("local-mock") || parserVersion.includes("mock")) {
    return "mock_parser_version";
  }
  if (!isLiveArtifactRef(job.artifact_prefix)) return "missing_live_artifact_ref";
  return "not_live_collector_job";
}

function liveCollectorMissingEvidence(
  sourceIds: string[],
  liveSourceIds: Set<string>,
  jobs: LatestSourceJobForService[],
) {
  const bySource = latestJobBySource(jobs);
  return sourceIds.filter((sourceId) => !liveSourceIds.has(sourceId)).map((sourceId) => {
    const job = bySource.get(sourceId);
    return {
      source_id: sourceId,
      reason: liveCollectorFailureReason(job),
      latest_status: job?.status ?? null,
      parser_version: job?.parser_version ?? null,
      artifact_prefix: job?.artifact_prefix ?? null,
      completed_at: job?.completed_at ?? null,
      created_at: job?.created_at ?? null,
    };
  });
}

function sourceCredentialCheck(
  sourceIds: string[],
  env: Record<string, string | undefined>,
  requirements: SourceCredentialRequirements | null | undefined,
  manifestError: string | null | undefined,
) {
  if (manifestError) {
    return check("source_credentials_present", "fail", {
      reason: "manifest_parse_error",
      error: manifestError,
    });
  }
  const requirementSource = requirements ? "collector_manifest" : "source_policy_default";
  const envNamesBySource = Object.fromEntries(sourceIds.map((sourceId) => [
    sourceId,
    requirements ? requirements[sourceId] ?? [] : SOURCE_CREDENTIAL_ENVS[sourceId] ?? [],
  ]));
  const invalid: Array<{ source_id: string; env_name: string | null; reason: string }> = [];
  for (const sourceId of sourceIds) {
    const hasExplicitManifestRequirement = requirements
      ? Object.hasOwn(requirements, sourceId)
      : false;
    const envNames = envNamesBySource[sourceId] ?? [];
    if (!envNames.length) {
      if (requirements && hasExplicitManifestRequirement) continue;
      invalid.push({ source_id: sourceId, env_name: null, reason: "missing_token_env" });
      continue;
    }
    for (const envName of envNames) {
      const reason = secretValueFailure(env[envName]);
      if (reason) invalid.push({ source_id: sourceId, env_name: envName, reason });
    }
  }
  return invalid.length === 0
    ? check("source_credentials_present", "pass", { source_ids: sourceIds, requirement_source: requirementSource, env_names_by_source: envNamesBySource })
    : check("source_credentials_present", "fail", { requirement_source: requirementSource, env_names_by_source: envNamesBySource, missing: invalid });
}

function collectorManifestConfiguredCheck(
  configured: boolean,
  manifestEnv: string,
  manifestError: string | null | undefined,
) {
  if (manifestError) {
    return check("collector_manifest_configured", "fail", {
      manifest_env: manifestEnv,
      reason: "manifest_parse_error",
      error: manifestError,
    });
  }
  return configured
    ? check("collector_manifest_configured", "pass", { manifest_env: manifestEnv })
    : check("collector_manifest_configured", "fail", {
        manifest_env: manifestEnv,
        reason: "missing",
      });
}

function postgresQueryableCheck(databaseConfigured: boolean | undefined, databaseError: string | null | undefined) {
  if (!databaseConfigured) {
    return check("postgres_read_model_queryable", "fail", { reason: "database_url_missing" });
  }
  return databaseError ? check("postgres_read_model_queryable", "fail", { error: databaseError }) : check("postgres_read_model_queryable", "pass");
}

function summarize(checks: ServiceCheck[]) {
  const failed = checks.filter((item) => item.status === "fail");
  const warned = checks.filter((item) => item.status === "warn");
  return {
    checks_total: checks.length,
    passed: checks.filter((item) => item.status === "pass").length,
    warned: warned.length,
    failed: failed.length,
    failed_checks: failed.map((item) => item.name),
    warning_checks: warned.map((item) => item.name),
    };
}

function batchSourceFlags(batchState: Record<string, unknown> | null | undefined) {
  const value = batchState?.source_flags ?? batchState?.sourceFlags;
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort()
    : [];
}

function lastBatchSourceCoverageCheck(batchState: Record<string, unknown> | null | undefined, sourceIds: string[]) {
  if (sourceIds.length === 0) {
    return check("last_batch_source_coverage", "pass", { source_ids: [] });
  }
  const sourceFlags = batchSourceFlags(batchState);
  if (sourceFlags.length === 0) {
    return check("last_batch_source_coverage", "fail", {
      reason: "missing_last_batch_source_flags",
      required_source_ids: sourceIds,
    });
  }
  const covered = new Set(sourceFlags);
  const missingSourceIds = sourceIds.filter((sourceId) => !covered.has(sourceId));
  return missingSourceIds.length === 0
    ? check("last_batch_source_coverage", "pass", { source_ids: sourceFlags })
    : check("last_batch_source_coverage", "fail", {
        source_ids: sourceFlags,
        required_source_ids: sourceIds,
        missing_source_ids: missingSourceIds,
      });
}

function isPlaceholderHost(host: string) {
  return (
    PLACEHOLDER_HOSTS.has(host) ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.net") ||
    host.endsWith(".example.org") ||
    host.endsWith(".example") ||
    host.endsWith(".test")
  );
}

function productionUrlFailure(rawUrl: string | undefined) {
  if (!rawUrl) return { reason: "missing" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { reason: "invalid_url", url: rawUrl };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return { reason: "not_https", protocol: url.protocol, host };
  if (LOCAL_HOSTS.has(host)) return { reason: "local_host", host };
  if (isPlaceholderHost(host)) {
    return { reason: "placeholder_host", host };
  }
  return null;
}

function alertChannelCheck(env: Record<string, string | undefined>) {
  const failure = productionUrlFailure(env.OPS_ALERT_WEBHOOK_URL);
  return failure
    ? check("alert_channel_configured", "fail", failure)
    : check("alert_channel_configured", "pass", { host: new URL(String(env.OPS_ALERT_WEBHOOK_URL)).hostname.toLowerCase() });
}

function supportContactCheck(env: Record<string, string | undefined>) {
  const contact = resolveSupportContact(env);
  if (!contact.ok && contact.reason === "missing") {
    return check("support_contact_configured", "fail", { reason: "missing", env_names: ["SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_EMAIL"] });
  }
  if (!contact.ok) {
    return check("support_contact_configured", "fail", { reason: contact.reason, env_name: contact.env_name, host: contact.host });
  }
  return check("support_contact_configured", "pass", { env_name: contact.env_name, host: contact.host });
}

function opsReadinessTokenCheck(env: Record<string, string | undefined>) {
  const reason = opsReadinessTokenFailure(env);
  return reason
    ? check("ops_readiness_token_configured", "fail", { env_name: OPS_READINESS_TOKEN_ENV, reason })
    : check("ops_readiness_token_configured", "pass", { env_name: OPS_READINESS_TOKEN_ENV });
}

function mockFallbackDisabledCheck(env: Record<string, string | undefined>) {
  const reason = serviceRequirePostgresFailure(env);
  return reason
    ? check("mock_fallback_disabled", "fail", { env_name: SERVICE_REQUIRE_POSTGRES_ENV, reason })
    : check("mock_fallback_disabled", "pass", { env_name: SERVICE_REQUIRE_POSTGRES_ENV });
}

function sourceKillSwitchesConfiguredCheck(env: Record<string, string | undefined>) {
  const invalid = [];
  const enabledSourceIds = [];
  for (const source of SOURCE_POLICY_CATALOG) {
    const raw = env[source.env_flag];
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (!normalized) {
      invalid.push({ source_id: source.source_id, env_name: source.env_flag, reason: "missing" });
    } else if (SOURCE_FLAG_TRUE_VALUES.has(normalized)) {
      enabledSourceIds.push(source.source_id);
    } else if (!SOURCE_FLAG_FALSE_VALUES.has(normalized)) {
      invalid.push({ source_id: source.source_id, env_name: source.env_flag, reason: "invalid_boolean" });
    }
  }
  return invalid.length === 0
    ? check("source_kill_switches_configured", "pass", {
        env_flags: SOURCE_POLICY_CATALOG.map((source) => source.env_flag),
        enabled_source_ids: enabledSourceIds,
      })
    : check("source_kill_switches_configured", "fail", {
        expected: "true or false for every source policy env flag",
        invalid,
      });
}

function sourceMaxStaleHoursConfiguredCheck(env: Record<string, string | undefined>) {
  const raw = String(env.SOURCE_MAX_STALE_HOURS ?? "").trim();
  if (!raw) {
    return check("source_max_stale_hours_configured", "fail", {
      env_name: "SOURCE_MAX_STALE_HOURS",
      reason: "missing",
    });
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0
    ? check("source_max_stale_hours_configured", "pass", {
        env_name: "SOURCE_MAX_STALE_HOURS",
        hours: value,
      })
    : check("source_max_stale_hours_configured", "fail", {
        env_name: "SOURCE_MAX_STALE_HOURS",
        reason: "invalid_positive_integer",
      });
}

function operationalHistoryCheck(history: OperationalHistoryInput | null | undefined, sourceIds: string[]) {
  const windowDays = history?.window_days ?? 7;
  const expectedJobs = Math.max(sourceIds.length * windowDays, sourceIds.length);
  if (!history) {
    return check("collector_success_rate_7d", "fail", { reason: "missing_operational_history", window_days: windowDays });
  }
  const liveSuccessSources = new Set(history.live_success_source_ids);
  const missingLiveSourceIds = sourceIds.filter((sourceId) => !liveSuccessSources.has(sourceId));
  const successRate = history.success_rate ?? 0;
  if (history.total_jobs < expectedJobs) {
    return check("collector_success_rate_7d", "fail", {
      reason: "insufficient_history",
      window_days: windowDays,
      total_jobs: history.total_jobs,
      expected_jobs: expectedJobs,
      success_rate: Number(successRate.toFixed(4)),
      missing_live_source_ids: missingLiveSourceIds,
    });
  }
  if (successRate < 0.95 || missingLiveSourceIds.length > 0) {
    return check("collector_success_rate_7d", "fail", {
      reason: "success_rate_or_live_coverage_below_threshold",
      window_days: windowDays,
      success_rate: Number(successRate.toFixed(4)),
      minimum_success_rate: 0.95,
      total_jobs: history.total_jobs,
      success_count: history.success_count,
      failure_count: history.failure_count,
      live_success_count: history.live_success_count,
      missing_live_source_ids: missingLiveSourceIds,
    });
  }
  return check("collector_success_rate_7d", "pass", {
    window_days: windowDays,
    success_rate: Number(successRate.toFixed(4)),
    total_jobs: history.total_jobs,
    success_count: history.success_count,
    failure_count: history.failure_count,
    live_success_count: history.live_success_count,
  });
}

function sourceHealthReadyCheck(sourceReadiness: SourceReadinessForService | null | undefined, sourceFlags: string[]) {
  const blockedSourceIds = sourceReadiness?.blocked_source_ids ?? [];
  const sourceBlockReasons = (sourceReadiness?.sources ?? [])
    .filter((source) => source.env_enabled !== false && source.search_eligible !== true)
    .map((source) => ({
      source_id: source.source_id ?? null,
      reason: source.block_reason ?? "not_search_eligible",
      env_flag: source.env_flag ?? null,
    }))
    .filter((source) => source.source_id);
  const detail = {
    status: sourceReadiness?.status ?? "missing",
    source_flags: sourceFlags,
    blocked_source_ids: blockedSourceIds,
    readiness_blockers: sourceReadiness?.readiness_blockers ?? [],
    source_block_reasons: sourceBlockReasons,
  };

  return sourceReadiness?.status === "ready"
    ? check("source_health_ready", "pass", detail)
    : check("source_health_ready", "fail", detail);
}

export function serviceSourceScope(
  sourceReadiness: SourceReadinessForService | null | undefined,
  sourceCredentialRequirements: SourceCredentialRequirements | null,
) {
  const envEnabledSourceIds = (sourceReadiness?.sources ?? [])
    .filter((source) => source.env_enabled !== false)
    .map((source) => String(source.source_id ?? "").trim())
    .filter(Boolean);
  const manifestSourceIds = Object.keys(sourceCredentialRequirements ?? {});
  const eligibleSourceIds = sourceReadiness?.source_flags ?? [];
  const sourceIds = [
    ...envEnabledSourceIds,
    ...manifestSourceIds,
    ...eligibleSourceIds,
  ];

  return sourceIds.length > 0 ? [...new Set(sourceIds)].sort() : Object.keys(SOURCE_CREDENTIAL_ENVS).sort();
}

function sourcePolicyCatalogCoverageCheck(sourceIds: string[]) {
  const knownSourceIds = new Set(SOURCE_POLICY_CATALOG.map((source) => source.source_id));
  const unknownSourceIds = sourceIds.filter((sourceId) => !knownSourceIds.has(sourceId));
  return unknownSourceIds.length === 0
    ? check("source_policy_catalog_coverage", "pass", { source_ids: sourceIds })
    : check("source_policy_catalog_coverage", "fail", {
        unknown_source_ids: unknownSourceIds,
        required_policy_fields: ["env_flag", "default_enabled", "booking_source_keys"],
      });
}

function deepLinkCountBySource(deepLinkAudit: DeepLinkAuditInput | null | undefined) {
  const explicitCounts = deepLinkAudit?.valid_count_by_source ?? {};
  if (Object.keys(explicitCounts).length > 0) {
    return Object.fromEntries(Object.entries(explicitCounts)
      .map(([sourceId, count]) => [sourceId, Number(count)])
      .filter(([sourceId, count]) => sourceId && Number.isFinite(count as number) && (count as number) >= 0)
      .sort(([left], [right]) => String(left).localeCompare(String(right)))) as Record<string, number>;
  }
  return Object.fromEntries((deepLinkAudit?.source_ids_with_links ?? []).map((sourceId) => [sourceId, 1]));
}

function deepLinkSampleDepthCheck(deepLinkAudit: DeepLinkAuditInput | null | undefined, sourceIds: string[]) {
  const validCountBySource = deepLinkCountBySource(deepLinkAudit);
  const shortSourceIds = sourceIds
    .map((sourceId) => ({
      source_id: sourceId,
      valid_count: validCountBySource[sourceId] ?? 0,
      minimum: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
    }))
    .filter((source) => source.valid_count < MIN_DEEPLINK_SAMPLES_PER_SOURCE);
  return shortSourceIds.length === 0
    ? check("booking_deeplink_sample_depth", "pass", {
        minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        valid_count_by_source: validCountBySource,
      })
    : check("booking_deeplink_sample_depth", "fail", {
        reason: "insufficient_valid_deeplink_samples",
        minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        valid_count_by_source: validCountBySource,
        short_source_ids: shortSourceIds,
      });
}

function deepLinkShapeCheck(deepLinkAudit: DeepLinkAuditInput | null | undefined) {
  const sampleSize = deepLinkAudit?.sample_size ?? 0;
  const invalidCount = deepLinkAudit?.invalid_count ?? 0;
  const invalidRate = sampleSize > 0 ? Number((invalidCount / sampleSize).toFixed(4)) : null;
  const detail = {
    sample_size: sampleSize,
    invalid_count: invalidCount,
    invalid_rate: invalidRate,
    max_invalid_rate: MAX_BROKEN_DEEPLINK_RATE,
    distinct_hosts: deepLinkAudit?.distinct_hosts ?? [],
  };
  return deepLinkAudit && sampleSize > 0 && invalidCount === 0
    ? check("booking_deeplink_shape", "pass", detail)
    : check("booking_deeplink_shape", "fail", {
        ...detail,
        reason: sampleSize > 0 && invalidRate !== null && invalidRate > MAX_BROKEN_DEEPLINK_RATE
          ? "broken_deeplink_rate_above_threshold"
          : "invalid_deeplink_sample",
      });
}

export function buildServiceReadinessSnapshot(input: ServiceReadinessInput): ServiceReadinessSnapshot {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const sourceReadiness = input.sourceReadiness;
  const sourceFlags = sourceReadiness?.source_flags ?? [];
  const eligibleSourceCount = sourceReadiness?.counts?.search_eligible_sources ?? sourceFlags.length;
  const counts = input.counts ?? null;
  const policyArtifacts = input.policyArtifacts ?? {};
  const userExperienceArtifacts = input.userExperienceArtifacts ?? {};
  const launchArtifacts = input.launchArtifacts ?? {};
  const sourceCredentialRequirements = input.sourceCredentialRequirements ?? null;
  const sourceCredentialManifestEnv = input.sourceCredentialManifestEnv ?? "COLLECTOR_SOURCE_MANIFEST_JSON";
  const sourceCredentialManifestConfigured = input.sourceCredentialManifestConfigured ?? Boolean(sourceCredentialRequirements);
  const sourceScope = serviceSourceScope(sourceReadiness, sourceCredentialRequirements);
  const latestJobs = input.latestJobs ?? [];
  const liveJobs = latestJobs.filter(isLiveCollectorJob);
  const liveSourceIds = new Set(liveJobs.map((job) => String(job.source_id ?? "")).filter(Boolean));
  const missingLiveSourceIds = sourceScope.filter((sourceId) => !liveSourceIds.has(sourceId));
  const missingLiveCollectorEvidence = liveCollectorMissingEvidence(sourceScope, liveSourceIds, latestJobs);
  const deepLinkAudit = input.deepLinkAudit;
  const deepLinkSourceIds = new Set(deepLinkAudit?.source_ids_with_links ?? []);
  const missingDeepLinkSourceIds = sourceScope.filter((sourceId) => !deepLinkSourceIds.has(sourceId));

  const dataSupplyChecks = [
    check("postgres_read_model_configured", input.databaseConfigured ? "pass" : "fail"),
    postgresQueryableCheck(input.databaseConfigured, input.databaseError),
    successfulBatchCheck(input.batchState, now, env),
    lastBatchSourceCoverageCheck(input.batchState, sourceScope),
    eligibleSourceCount >= MINIMUM_SEARCH_ELIGIBLE_SOURCES
      ? check("eligible_sources_minimum", "pass", { search_eligible_sources: eligibleSourceCount })
      : check("eligible_sources_minimum", "fail", {
          search_eligible_sources: eligibleSourceCount,
          minimum: MINIMUM_SEARCH_ELIGIBLE_SOURCES,
        }),
    sourcePolicyCatalogCoverageCheck(sourceScope),
    missingLiveSourceIds.length === 0
      ? check("live_collector_success", "pass", { live_source_ids: [...liveSourceIds].sort() })
      : check("live_collector_success", "fail", {
          reason: "enabled sources require non-mock successful collector jobs with collector artifact refs",
          missing_source_ids: missingLiveSourceIds,
          missing: missingLiveCollectorEvidence,
        }),
    collectorManifestConfiguredCheck(
      sourceCredentialManifestConfigured,
      sourceCredentialManifestEnv,
      input.sourceCredentialManifestError,
    ),
    sourceCredentialCheck(sourceScope, env, sourceCredentialRequirements, input.sourceCredentialManifestError),
    counts && Number(counts.offers_active ?? 0) > 0 && Number(counts.deals_current_active ?? 0) > 0
      ? check("inventory_present", "pass", { offers_active: counts.offers_active, deals_current_active: counts.deals_current_active })
      : check("inventory_present", "fail", { counts }),
  ];

  const bookingChecks = [
    deepLinkAudit && deepLinkAudit.sample_size > 0
      ? check("booking_deeplink_sample_present", "pass", { sample_size: deepLinkAudit.sample_size })
      : check("booking_deeplink_sample_present", "fail", { sample_size: deepLinkAudit?.sample_size ?? 0 }),
    deepLinkSampleDepthCheck(deepLinkAudit, sourceScope),
    deepLinkShapeCheck(deepLinkAudit),
    deepLinkAudit && deepLinkAudit.sample_size > 0 && missingDeepLinkSourceIds.length === 0
      ? check("booking_deeplink_source_coverage", "pass", { source_ids_with_links: [...deepLinkSourceIds].sort() })
      : check("booking_deeplink_source_coverage", "fail", {
          required_source_ids: sourceScope,
          source_ids_with_links: [...deepLinkSourceIds].sort(),
          missing_source_ids: missingDeepLinkSourceIds,
        }),
  ];

  const operationsChecks = [
    sourceHealthReadyCheck(sourceReadiness, sourceFlags),
    operationalHistoryCheck(input.operationalHistory, sourceScope),
    alertChannelCheck(env),
    policyArtifacts.readinessApi
      ? check("readiness_api_available", "pass")
      : check("readiness_api_available", "fail"),
    opsReadinessTokenCheck(env),
  ];

  const userExperienceChecks = [
    policyArtifacts.readinessPage
      ? check("status_page_available", "pass")
      : check("status_page_available", "fail"),
    userExperienceArtifacts.trustCues
      ? check("trust_cues_available", "pass", { surfaces: ["/map"] })
      : check("trust_cues_available", "fail", { surfaces: ["/map"] }),
    userExperienceArtifacts.serviceUnavailableUi
      ? check("service_unavailable_ui_available", "pass", { surfaces: ["/", "/map", "/offers", "/destination/[placeId]"] })
      : check("service_unavailable_ui_available", "fail", { surfaces: ["/", "/map", "/offers", "/destination/[placeId]"] }),
    counts && Number(counts.deals_current_active ?? 0) > 0
      ? check("search_inventory_available", "pass", { deals_current_active: counts.deals_current_active })
      : check("search_inventory_available", "fail", { counts }),
    supportContactCheck(env),
  ];

  const policyChecks = [
    policyArtifacts.publicPolicyPage
      ? check("public_policy_page", "pass")
      : check("public_policy_page", "fail"),
    policyArtifacts.affiliateDisclosure
      ? check("affiliate_disclosure", "pass")
      : check("affiliate_disclosure", "fail"),
    policyArtifacts.dataAccuracyDisclosure
      ? check("data_accuracy_disclosure", "pass")
      : check("data_accuracy_disclosure", "fail"),
    policyArtifacts.supportContactDisclosure
      ? check("support_contact_disclosure", "pass")
      : check("support_contact_disclosure", "fail"),
  ];

  const launchChecks = [
    (launchArtifacts.opsRunbook ?? policyArtifacts.opsRunbook)
      ? check("ops_runbook_available", "pass")
      : check("ops_runbook_available", "fail"),
    launchArtifacts.envTemplate
      ? check("env_template_available", "pass", { path: ".env.example" })
      : check("env_template_available", "fail", { path: ".env.example" }),
    launchArtifacts.runtimeEnvPreflight
      ? check("runtime_env_preflight_available", "pass", { script: "scripts/service-env-preflight.mjs", mode: "--runtime-only" })
      : check("runtime_env_preflight_available", "fail", { script: "scripts/service-env-preflight.mjs", mode: "--runtime-only" }),
    launchArtifacts.contractTestGate
      ? check("contract_test_gate_available", "pass", {
          commands: ["npm test", "python3 -m unittest discover -s tests"],
          workflow: ".github/workflows/collect-fares.yml",
        })
      : check("contract_test_gate_available", "fail", {
          commands: ["npm test", "python3 -m unittest discover -s tests"],
          workflow: ".github/workflows/collect-fares.yml",
        }),
    launchArtifacts.productionBuildGate
      ? check("production_build_gate_available", "pass", { command: "npm run build", workflow: ".github/workflows/collect-fares.yml" })
      : check("production_build_gate_available", "fail", { command: "npm run build", workflow: ".github/workflows/collect-fares.yml" }),
    mockFallbackDisabledCheck(env),
    sourceKillSwitchesConfiguredCheck(env),
    sourceMaxStaleHoursConfiguredCheck(env),
    launchArtifacts.productionManifestTemplate
      ? check("production_manifest_template_available", "pass", { path: "configs/collector-source-manifest.production.example.json" })
      : check("production_manifest_template_available", "fail", { path: "configs/collector-source-manifest.production.example.json" }),
    launchArtifacts.collectorWorkflow
      ? check("collector_workflow_gate_configured", "pass", { path: ".github/workflows/collect-fares.yml" })
      : check("collector_workflow_gate_configured", "fail", { path: ".github/workflows/collect-fares.yml" }),
    launchArtifacts.collectorArtifactUpload
      ? check("collector_artifact_upload_configured", "pass", {
          path: "runtime/collector-artifacts",
          artifact: "collector-artifacts",
          if_no_files_found: "error",
          retention_days: 30,
        })
      : check("collector_artifact_upload_configured", "fail", {
          path: "runtime/collector-artifacts",
          artifact: "collector-artifacts",
          if_no_files_found: "error",
          retention_days: 30,
        }),
    launchArtifacts.publicApiFallbackGuard
      ? check("public_api_503_guard_available", "pass", {
          routes: ["/api/search", "/api/deals/map", "/api/deals/calendar", "/api/offers"],
          policy: "SERVICE_REQUIRE_POSTGRES suppresses mock fallback with 503/no-store",
        })
      : check("public_api_503_guard_available", "fail", {
          routes: ["/api/search", "/api/deals/map", "/api/deals/calendar", "/api/offers"],
          policy: "SERVICE_REQUIRE_POSTGRES suppresses mock fallback with 503/no-store",
        }),
    check("kill_switch_available", "pass", {
      env_flags: SOURCE_POLICY_CATALOG.map((source) => source.env_flag),
    }),
    launchArtifacts.prodReadinessGate
      ? check("production_gate_available", "pass", { script: "scripts/prod-readiness-smoke.mjs" })
      : check("production_gate_available", "fail", { script: "scripts/prod-readiness-smoke.mjs" }),
    launchArtifacts.serviceReadinessGate
      ? check("service_gate_available", "pass", { script: "scripts/service-readiness-smoke.mjs" })
      : check("service_gate_available", "fail", { script: "scripts/service-readiness-smoke.mjs" }),
    launchArtifacts.opsAlertGate
      ? check("ops_alert_gate_available", "pass", { script: "scripts/ops-alert-smoke.mjs" })
      : check("ops_alert_gate_available", "fail", { script: "scripts/ops-alert-smoke.mjs" }),
    launchArtifacts.serviceLaunchAudit
      ? check("service_launch_audit_available", "pass", {
          script: "scripts/service-launch-audit.mjs",
          output_dir: "runtime/service-launch-audits",
          evidence_checklist: true,
          retention_days: 90,
          required_evidence: ["release_gate", "alert_delivery", "collector_cutover", "collector_history_7d", "deeplink_samples", "persisted_launch_report"],
        })
      : check("service_launch_audit_available", "fail", {
          script: "scripts/service-launch-audit.mjs",
          output_dir: "runtime/service-launch-audits",
          evidence_checklist: true,
          retention_days: 90,
          required_evidence: ["release_gate", "alert_delivery", "collector_cutover", "collector_history_7d", "deeplink_samples", "persisted_launch_report"],
        }),
  ];

  const axes = [
    axis("data_supply", dataSupplyChecks),
    axis("booking_conversion", bookingChecks),
    axis("operations_monitoring", operationsChecks),
    axis("user_experience", userExperienceChecks),
    axis("policy_compliance", policyChecks),
    axis("launch_operations", launchChecks),
  ];
  const allChecks = axes.flatMap((item) => item.checks);
  const summary = summarize(allChecks);

  return {
    status: summary.failed === 0 ? "ready" : "not_ready",
    generated_at: now.toISOString(),
    summary,
    launch_blockers: axes.flatMap((item) => item.next_actions),
    axes,
  };
}
