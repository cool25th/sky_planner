import {
  SOURCE_POLICY_CATALOG,
  enabledSourceFlagsFromEnv,
  sourceHealthBlockReason,
  sourceMaxStaleHoursFromEnv,
  type SourceHealthStatus,
} from "./source-policy.ts";
import { serviceRequiresPostgres } from "./service-mode.ts";

type EnvLike = Record<string, string | undefined>;
const MINIMUM_SEARCH_ELIGIBLE_SOURCES = 2;
const SOURCE_FLAG_TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const SOURCE_FLAG_FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export interface SourceHealthRow extends SourceHealthStatus {
  last_failure_at?: Date | string | null;
  last_failure_code?: string | null;
  last_checked_at?: Date | string | null;
  last_artifact_prefix?: string | null;
  stats_24h?: Record<string, unknown> | null;
}

export interface SourceJobRow {
  source_id?: string | null;
  execution_id?: string | null;
  status?: string | null;
  parser_version?: string | null;
  offers_found?: number | string | null;
  offers_changed?: number | string | null;
  snapshots_written?: number | string | null;
  deals_recomputed?: number | string | null;
  failure_code?: string | null;
  last_error?: string | null;
  started_at?: Date | string | null;
  completed_at?: Date | string | null;
  created_at?: Date | string | null;
}

interface SourceReadinessInput {
  healthRows: SourceHealthRow[];
  latestJobs?: SourceJobRow[];
  batchState?: Record<string, unknown> | null;
  env?: EnvLike;
  now?: Date;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectedJobFields(job: SourceJobRow | undefined) {
  if (!job) return null;
  return {
    execution_id: job.execution_id ?? null,
    status: job.status ?? null,
    parser_version: job.parser_version ?? null,
    offers_found: numeric(job.offers_found),
    offers_changed: numeric(job.offers_changed),
    snapshots_written: numeric(job.snapshots_written),
    deals_recomputed: numeric(job.deals_recomputed),
    failure_code: job.failure_code ?? null,
    last_error: job.last_error ?? null,
    started_at: iso(job.started_at),
    completed_at: iso(job.completed_at),
    created_at: iso(job.created_at),
  };
}

function sourcePolicyEnvIssues(env: EnvLike) {
  if (!serviceRequiresPostgres(env)) {
    return {
      invalid_source_flags: [],
      stale_hours_issue: null,
    };
  }

  const invalidSourceFlags = SOURCE_POLICY_CATALOG.flatMap((policy) => {
    const raw = env[policy.env_flag];
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (!normalized) return [{ source_id: policy.source_id, env_name: policy.env_flag, reason: "missing" }];
    if (SOURCE_FLAG_TRUE_VALUES.has(normalized) || SOURCE_FLAG_FALSE_VALUES.has(normalized)) return [];
    return [{ source_id: policy.source_id, env_name: policy.env_flag, reason: "invalid_boolean" }];
  });
  const staleHoursRaw = String(env.SOURCE_MAX_STALE_HOURS ?? "").trim();
  const staleHoursValue = Number(staleHoursRaw);
  const staleHoursIssue = !staleHoursRaw
    ? { env_name: "SOURCE_MAX_STALE_HOURS", reason: "missing" }
    : Number.isInteger(staleHoursValue) && staleHoursValue > 0
      ? null
      : { env_name: "SOURCE_MAX_STALE_HOURS", reason: "invalid_positive_integer" };

  return {
    invalid_source_flags: invalidSourceFlags,
    stale_hours_issue: staleHoursIssue,
  };
}

export function buildSourceReadinessSnapshot(input: SourceReadinessInput) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const enabledFlags = enabledSourceFlagsFromEnv(env);
  const maxStaleHours = sourceMaxStaleHoursFromEnv(env);
  const envIssues = sourcePolicyEnvIssues(env);
  const sourcePolicyEnvReady = envIssues.invalid_source_flags.length === 0 && !envIssues.stale_hours_issue;
  const healthBySource = new Map(input.healthRows.map((row) => [String(row.source_id ?? ""), row]));
  const latestJobBySource = new Map((input.latestJobs ?? []).map((job) => [String(job.source_id ?? ""), job]));

  const sources = SOURCE_POLICY_CATALOG.map((policy) => {
    const envEnabled = enabledFlags.includes(policy.source_id);
    const health = healthBySource.get(policy.source_id);
    const blockReason = envEnabled ? sourceHealthBlockReason(health, now, maxStaleHours) : "disabled_by_env";
    return {
      source_id: policy.source_id,
      env_flag: policy.env_flag,
      env_enabled: envEnabled,
      search_eligible: envEnabled && blockReason === null,
      block_reason: blockReason,
      default_enabled: policy.default_enabled,
      booking_source_keys: policy.booking_source_keys,
      health: health ? {
        is_paused: Boolean(health.is_paused),
        enabled_by_flag: health.enabled_by_flag !== false,
        circuit_breaker_open: Boolean(health.circuit_breaker_open),
        consecutive_failures: numeric(health.consecutive_failures),
        last_success_at: iso(health.last_success_at),
        last_failure_at: iso(health.last_failure_at),
        last_failure_code: health.last_failure_code ?? null,
        last_checked_at: iso(health.last_checked_at),
        last_artifact_prefix: health.last_artifact_prefix ?? null,
        stats_24h: health.stats_24h ?? null,
      } : null,
      latest_job: selectedJobFields(latestJobBySource.get(policy.source_id)),
    };
  });

  const enabledSources = sources.filter((source) => source.env_enabled);
  const eligibleSources = sourcePolicyEnvReady ? sources.filter((source) => source.search_eligible) : [];
  const blockedSources = enabledSources.filter((source) => !source.search_eligible);
  const lastBatch = input.batchState ?? null;
  const batchStatus = typeof lastBatch?.status === "string" ? lastBatch.status : null;
  const readinessBlockers = [
    ...(envIssues.invalid_source_flags.length > 0 ? ["source_kill_switches_invalid"] : []),
    ...(envIssues.stale_hours_issue ? ["source_max_stale_hours_invalid"] : []),
    ...(batchStatus === "success" ? [] : [batchStatus ? `last_batch_${batchStatus}` : "last_batch_missing"]),
    ...(eligibleSources.length >= MINIMUM_SEARCH_ELIGIBLE_SOURCES ? [] : ["insufficient_search_eligible_sources"]),
  ];

  return {
    status: readinessBlockers.length === 0 ? "ready" : "not_ready",
    generated_at: now.toISOString(),
    max_stale_hours: maxStaleHours,
    last_batch: lastBatch,
    counts: {
      policy_sources: sources.length,
      env_enabled_sources: enabledSources.length,
      search_eligible_sources: eligibleSources.length,
      minimum_search_eligible_sources: MINIMUM_SEARCH_ELIGIBLE_SOURCES,
      blocked_sources: blockedSources.length,
    },
    env_config: {
      service_requires_postgres: serviceRequiresPostgres(env),
      invalid_source_flags: envIssues.invalid_source_flags,
      source_max_stale_hours_issue: envIssues.stale_hours_issue,
    },
    readiness_blockers: readinessBlockers,
    source_flags: eligibleSources.map((source) => source.source_id),
    blocked_source_ids: blockedSources.map((source) => source.source_id),
    sources,
  };
}
