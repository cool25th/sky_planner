import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { errorMessage } from "../lib/error-message.ts";
import { enrichInternalServiceReadinessSnapshot } from "../lib/ops-visibility.ts";
import { policyArtifactSnapshot, userExperienceArtifactSnapshot } from "../lib/readiness-artifacts.ts";
import { sourceCredentialRequirementsFromManifestEnv } from "../lib/service-credential-requirements.ts";
import { buildServiceReadinessSnapshot, serviceSourceScope } from "../lib/service-readiness.ts";
import { buildSourceReadinessSnapshot } from "../lib/source-readiness.ts";
import { SOURCE_POLICY_CATALOG, sourceIdForBookingSourceKey } from "../lib/source-policy.ts";
import { sendOpsAlert } from "./ops-alert-smoke.mjs";

const { Client } = pg;

const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org", "example.test"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const OPERATIONAL_HISTORY_WINDOW_DAYS = 7;
const DEFAULT_MANIFEST_ENV = "COLLECTOR_SOURCE_MANIFEST_JSON";
const TRACKING_QUERY_PARAMS = new Set(["_ga", "_gl", "dclid", "fbclid", "gbraid", "gclid", "mc_cid", "mc_eid", "msclkid", "wbraid", "yclid"]);
const LIVE_ARTIFACT_SQL = `
  COALESCE(artifact_prefix, '') <> ''
  AND artifact_prefix !~* '^(local|file|test)://'
  AND artifact_prefix ILIKE '%collector-artifacts/%'
`;

async function artifactContains(relativePath, requiredTokens) {
  try {
    const contents = await readFile(path.join(process.cwd(), relativePath), "utf-8");
    return requiredTokens.every((token) => contents.includes(token));
  } catch {
    return false;
  }
}

async function launchArtifactSnapshot() {
  const [
    opsRunbook,
    envTemplate,
    runtimeEnvPreflight,
    contractTestGate,
    productionBuildGate,
    productionManifestTemplate,
    collectorWorkflow,
    collectorArtifactUpload,
    publicApiFallbackGuard,
    prodReadinessGate,
    serviceReadinessGate,
    opsAlertGate,
    serviceLaunchAudit,
  ] = await Promise.all([
    artifactContains("require/ops.md", ["출시 게이트", "smoke:service-readiness", "smoke:ops-alert", "SERVICE_REQUIRE_POSTGRES", "COLLECTOR_SOURCE_MANIFEST_JSON", "OPS_READINESS_TOKEN", "SKYSCANNER_FEED_API_KEY", "KOREAN_AIR_FEED_API_KEY", "ASIANA_FEED_API_KEY"]),
    artifactContains(".env.example", ["DATABASE_URL", "COLLECTOR_SOURCE_MANIFEST_JSON", "SERVICE_REQUIRE_POSTGRES", "OPS_ALERT_WEBHOOK_URL", "OPS_READINESS_TOKEN", "SUPPORT_EMAIL", "SOURCE_MAX_STALE_HOURS", "SOURCE_GOOGLE_FLIGHTS_ENABLED", "SOURCE_KAYAK_ENABLED", "SOURCE_PROMO_PAGES_ENABLED"]),
    artifactContains("scripts/service-env-preflight.mjs", ["buildServiceRuntimeEnvPreflight", "--runtime-only", "sourceKillSwitchesCheck", "source_max_stale_hours_configured"]),
    Promise.all([
      artifactContains("package.json", ["\"test\"", "--test tests/*.mjs"]),
      artifactContains(".github/workflows/collect-fares.yml", ["audit:service-launch", "--verify-release-gates"]),
      artifactContains("scripts/service-launch-audit.mjs", ["js_contract_tests", "npm\", \"test", "python_backend_tests", "python3\", \"-m\", \"unittest\""]),
    ]).then((checks) => checks.every(Boolean)),
    Promise.all([
      artifactContains("package.json", ["\"build\"", "next build"]),
      artifactContains(".github/workflows/collect-fares.yml", ["audit:service-launch", "--verify-release-gates"]),
      artifactContains("scripts/service-launch-audit.mjs", ["production_build", "npm\", \"run\", \"build"]),
    ]).then((checks) => checks.every(Boolean)),
    artifactContains("configs/collector-source-manifest.production.example.json", ["collector.source_manifest.v1", "skyscanner_affiliate", "KOREAN_AIR_FEED_API_KEY"]),
    artifactContains(".github/workflows/collect-fares.yml", ["audit:service-launch", "--verify-release-gates", "--run-collector", "upload-artifact", "runtime/service-launch-audits", "if-no-files-found: error", "retention-days: 90", "SOURCE_SKYSCANNER_ENABLED", "SOURCE_GOOGLE_FLIGHTS_ENABLED", "SOURCE_MAX_STALE_HOURS"]),
    artifactContains(".github/workflows/collect-fares.yml", ["name: collector-artifacts", "runtime/collector-artifacts", "if-no-files-found: error", "retention-days: 30"]),
    Promise.all([
      artifactContains("app/api/search/route.ts", ["dynamic = \"force-dynamic\"", "apiStatusForResponse", "apiHeadersForResponse", "resolveSearchResponse"]),
      artifactContains("app/api/deals/map/route.ts", ["dynamic = \"force-dynamic\"", "apiStatusForResponse", "apiHeadersForResponse", "resolveMapResponse"]),
      artifactContains("app/api/deals/calendar/route.ts", ["dynamic = \"force-dynamic\"", "apiStatusForResponse", "apiHeadersForResponse", "resolveCalendarResponse"]),
      artifactContains("app/api/offers/route.ts", ["dynamic = \"force-dynamic\"", "apiStatusForResponse", "apiHeadersForResponse", "resolveOffersResponse"]),
      artifactContains("lib/data-source.ts", ["serviceRequiresPostgres", "serviceApiReadinessBlockReason", "suppressMockFallback", "service_read_model_unavailable", "fallback_suppressed"]),
    ]).then((checks) => checks.every(Boolean)),
    artifactContains("scripts/prod-readiness-smoke.mjs", ["auditCollectorManifest", "validateBookingDeepLink", "booking_deeplink_sample_depth", "canonicalDeepLink", "sampleBookingDeepLinks"]),
    artifactContains("scripts/service-readiness-smoke.mjs", ["auditServiceReadiness", "buildServiceReadinessCliOutput", "enrichInternalServiceReadinessSnapshot", "--manifest-env", "service_readiness_not_ready", "operator_actions", "booking_deeplink_sample_depth", "canonicalDeepLink", "valid_count_by_source", "buildServiceReadinessAlertPayload", "broken_deeplink_rate"]),
    artifactContains("scripts/ops-alert-smoke.mjs", ["sendOpsAlert", "validateOpsAlertWebhookUrl"]),
    artifactContains("scripts/service-launch-audit.mjs", ["buildServiceLaunchPlan", "runServiceLaunchAudit", "writeServiceLaunchReport", "buildServiceLaunchActionPlan", "buildServiceLaunchEvidenceChecklist", "buildServiceLaunchDecision", "serviceLaunchAuditExitCode", "loadAuditEnvOverrides", "launch_decision", "ready_to_launch", "action_plan", "operator_actions", "sanitizeOperatorActions", "remediationFromOperatorAction", "rerun_command", "env_checklist", "evidence_checklist", "evidence_checklist_status", "evidence_checklist_not_present", "env_input", "--env-file", "--verify-release-gates", "[REDACTED_DATABASE_URL]", "--output-dir", "collector:sources", "requires_pass", "failed_prerequisite", "smoke:service-readiness", "ops_alert_sent", "collector_sources_succeeded", "collector_sources_failed", "production_readiness_status", "service_readiness_status", "release_gates_missing", "release_gates_passed", "decision_blockers", "decisionBlockerActionItems", "collector_audit_missing", "evidence_report_missing", "evidence_report_path"]),
  ]);
  return {
    opsRunbook,
    envTemplate,
    runtimeEnvPreflight,
    contractTestGate,
    productionBuildGate,
    productionManifestTemplate,
    collectorWorkflow,
    collectorArtifactUpload,
    publicApiFallbackGuard,
    prodReadinessGate,
    serviceReadinessGate,
    opsAlertGate,
    serviceLaunchAudit,
  };
}

function parseArgs(argv) {
  const args = {
    databaseUrl: process.env.DATABASE_URL || "",
    deeplinkSampleSize: 40,
    manifestEnv: DEFAULT_MANIFEST_ENV,
    notify: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--deeplink-sample-size") {
      args.deeplinkSampleSize = Number(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--manifest-env") {
      args.manifestEnv = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--notify") {
      args.notify = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.deeplinkSampleSize) || args.deeplinkSampleSize <= 0) {
    throw new Error("--deeplink-sample-size must be a positive integer");
  }
  if (!args.manifestEnv) throw new Error("--manifest-env must not be empty");
  return args;
}

function isPlaceholderHost(host) {
  return (
    PLACEHOLDER_HOSTS.has(host) ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.net") ||
    host.endsWith(".example.org") ||
    host.endsWith(".example") ||
    host.endsWith(".test")
  );
}

function invalidDeepLink(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return true;
    if (LOCAL_HOSTS.has(host)) return true;
    return isPlaceholderHost(host);
  } catch {
    return true;
  }
}

function deepLinkHosts(rows) {
  return [...new Set(rows.flatMap((row) => {
    if (!row.deep_link) return [];
    try {
      return [new URL(row.deep_link).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }))].sort();
}

function validDeepLinkCountsBySource(rows) {
  const urlsBySource = new Map();
  for (const row of rows) {
    if (invalidDeepLink(row.deep_link)) continue;
    const sourceId = sourceIdForBookingSourceKey(row.booking_source);
    if (!sourceId) continue;
    if (!urlsBySource.has(sourceId)) urlsBySource.set(sourceId, new Set());
    urlsBySource.get(sourceId).add(canonicalDeepLink(row.deep_link));
  }
  return Object.fromEntries([...urlsBySource.entries()]
    .map(([sourceId, urls]) => [sourceId, urls.size])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalDeepLink(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

function bookingSourceKeysForSource(sourceId) {
  const policy = SOURCE_POLICY_CATALOG.find((source) => source.source_id === sourceId);
  return [...new Set([sourceId, ...(policy?.booking_source_keys ?? [])]
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean))].sort();
}

async function countSnapshot(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM places) AS places,
      (SELECT COUNT(*)::int FROM offers WHERE is_active = true) AS offers_active,
      (SELECT COUNT(*)::int FROM deals_current WHERE is_active = true) AS deals_current_active,
      (SELECT COUNT(*)::int FROM source_health) AS source_health
  `);
  return rows[0] ?? null;
}

export async function deepLinkAudit(client, sourceFlags, sampleSize) {
  const sourceIds = [...new Set(sourceFlags)].sort();
  if (!sourceIds.length) {
    return { sample_size: 0, invalid_count: 0, distinct_hosts: [], valid_count_by_source: {} };
  }
  const rows = (await Promise.all(sourceIds.map(async (sourceId) => {
    const { rows: sourceRows } = await client.query(
      `
        SELECT deep_link
             , booking_source
        FROM offers
        WHERE is_active = true
          AND COALESCE(bookability_status, 'available') <> 'sold_out'
          AND COALESCE(price_status, 'active') <> 'sold_out'
          AND COALESCE(price_anomaly_status, 'normal') = 'normal'
          AND deep_link IS NOT NULL
          AND deep_link <> ''
          AND LOWER(COALESCE(booking_source, '')) = ANY($1::text[])
        ORDER BY
          last_seen_at DESC NULLS LAST,
          COALESCE(normalized_total_krw, total_price) ASC,
          offer_id ASC
        LIMIT $2
      `,
      [bookingSourceKeysForSource(sourceId), sampleSize],
    );
    return sourceRows;
  }))).flat();
  return {
    sample_size: rows.length,
    invalid_count: rows.filter((row) => invalidDeepLink(row.deep_link)).length,
    distinct_hosts: deepLinkHosts(rows),
    valid_count_by_source: validDeepLinkCountsBySource(rows),
    source_ids_with_links: [...new Set(rows
      .filter((row) => !invalidDeepLink(row.deep_link))
      .map((row) => sourceIdForBookingSourceKey(row.booking_source))
      .filter(Boolean))].sort(),
  };
}

async function operationalHistory(client, sourceFlags) {
  if (!sourceFlags.length) {
    return {
      window_days: OPERATIONAL_HISTORY_WINDOW_DAYS,
      total_jobs: 0,
      success_count: 0,
      failure_count: 0,
      live_success_count: 0,
      success_rate: null,
      live_success_source_ids: [],
    };
  }
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('success', 'failed'))::int AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failure_count,
        COUNT(*) FILTER (
          WHERE status = 'success'
            AND COALESCE(parser_version, '') !~* '(local-mock|mock)'
            AND ${LIVE_ARTIFACT_SQL}
        )::int AS live_success_count,
        COALESCE(
          ARRAY_AGG(DISTINCT source_id) FILTER (
            WHERE status = 'success'
              AND COALESCE(parser_version, '') !~* '(local-mock|mock)'
              AND ${LIVE_ARTIFACT_SQL}
          ),
          ARRAY[]::text[]
        ) AS live_success_source_ids
      FROM source_jobs
      WHERE source_id = ANY($1::text[])
        AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
    `,
    [sourceFlags, OPERATIONAL_HISTORY_WINDOW_DAYS],
  );
  const row = rows[0] ?? {};
  const totalJobs = Number(row.total_jobs ?? 0);
  const successCount = Number(row.success_count ?? 0);
  return {
    window_days: OPERATIONAL_HISTORY_WINDOW_DAYS,
    total_jobs: totalJobs,
    success_count: successCount,
    failure_count: Number(row.failure_count ?? 0),
    live_success_count: Number(row.live_success_count ?? 0),
    success_rate: totalJobs > 0 ? successCount / totalJobs : null,
    live_success_source_ids: [...(row.live_success_source_ids ?? [])].sort(),
  };
}

async function loadDatabaseSnapshot(options) {
  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const healthResult = await client.query(`
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
      `);
    const jobsResult = await client.query(`
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
          artifact_prefix,
          started_at,
          completed_at,
          created_at
        FROM source_jobs
        ORDER BY source_id, created_at DESC
      `);
    const batchResult = await client.query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1");
    const counts = await countSnapshot(client);

    const batchState = batchResult.rows[0]?.data ?? null;
    const sourceReadiness = buildSourceReadinessSnapshot({
      healthRows: healthResult.rows,
      latestJobs: jobsResult.rows,
      batchState,
      env: options.env,
    });
    const sourceScope = serviceSourceScope(sourceReadiness, options.sourceCredentialRequirements ?? null);

    return {
      counts,
      batchState,
      sourceReadiness,
      latestJobs: jobsResult.rows,
      deepLinkAudit: await deepLinkAudit(client, sourceScope, options.deeplinkSampleSize),
      operationalHistory: await operationalHistory(client, sourceScope),
    };
  } finally {
    await client.end();
  }
}

function findSnapshotCheck(output, checkName) {
  return output.axes
    ?.flatMap((axis) => axis.checks ?? [])
    .find((check) => check.name === checkName) ?? null;
}

function sanitizeAlertBlocker(value) {
  return String(value)
    .replace(/localhost\/example\/non-HTTPS host/g, "비운영/비HTTPS host")
    .replace(/localhost|example\.\*|example|\.test/gi, "비운영 host");
}

export function buildServiceReadinessAlertPayload(output) {
  const deepLinkShape = findSnapshotCheck(output, "booking_deeplink_shape");
  const collectorHistory = findSnapshotCheck(output, "collector_success_rate_7d");
  return {
    event: "service_readiness_not_ready",
    status: output.status,
    failed_checks: output.summary.failed_checks,
    launch_blockers: output.launch_blockers.map(sanitizeAlertBlocker),
    readiness_generated_at: output.generated_at,
    metrics: {
      broken_deeplink_rate: deepLinkShape?.detail?.invalid_rate ?? null,
      max_broken_deeplink_rate: deepLinkShape?.detail?.max_invalid_rate ?? null,
      broken_deeplink_count: deepLinkShape?.detail?.invalid_count ?? null,
      deeplink_sample_size: deepLinkShape?.detail?.sample_size ?? null,
      collector_success_rate_7d: collectorHistory?.detail?.success_rate ?? null,
      min_collector_success_rate_7d: collectorHistory?.detail?.minimum_success_rate ?? 0.95,
      collector_jobs_7d: collectorHistory?.detail?.total_jobs ?? null,
    },
  };
}

export function buildServiceReadinessCliOutput(snapshot) {
  return enrichInternalServiceReadinessSnapshot(snapshot);
}

async function notifyFailure(output) {
  return sendOpsAlert(buildServiceReadinessAlertPayload(output), {
    generatedAt: output.generated_at,
  });
}

export async function auditServiceReadiness(options = {}) {
  const env = options.env ?? process.env;
  const [launchArtifacts, policyArtifacts, userExperienceArtifacts] = await Promise.all([
    options.launchArtifacts ?? launchArtifactSnapshot(),
    options.policyArtifacts ?? policyArtifactSnapshot(),
    options.userExperienceArtifacts ?? userExperienceArtifactSnapshot(),
  ]);
  const credentialSnapshot = sourceCredentialRequirementsFromManifestEnv(env, options.manifestEnv ?? DEFAULT_MANIFEST_ENV);
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    return buildServiceReadinessSnapshot({
      env,
      databaseConfigured: false,
      databaseError: null,
      counts: null,
      batchState: null,
      sourceReadiness: null,
      latestJobs: [],
      deepLinkAudit: null,
      operationalHistory: null,
      sourceCredentialRequirements: credentialSnapshot.requirements,
      sourceCredentialManifestEnv: credentialSnapshot.manifest_env,
      sourceCredentialManifestConfigured: credentialSnapshot.configured,
      sourceCredentialManifestError: credentialSnapshot.error,
      policyArtifacts,
      userExperienceArtifacts,
      launchArtifacts,
    });
  }

  let database;
  try {
    database = await loadDatabaseSnapshot({
      databaseUrl,
      deeplinkSampleSize: options.deeplinkSampleSize ?? 40,
      env,
      sourceCredentialRequirements: credentialSnapshot.requirements,
    });
  } catch (err) {
    return buildServiceReadinessSnapshot({
      env,
      databaseConfigured: true,
      databaseError: errorMessage(err, "postgres_connection_failed"),
      counts: null,
      batchState: null,
      sourceReadiness: null,
      latestJobs: [],
      deepLinkAudit: null,
      operationalHistory: null,
      sourceCredentialRequirements: credentialSnapshot.requirements,
      sourceCredentialManifestEnv: credentialSnapshot.manifest_env,
      sourceCredentialManifestConfigured: credentialSnapshot.configured,
      sourceCredentialManifestError: credentialSnapshot.error,
      policyArtifacts,
      userExperienceArtifacts,
      launchArtifacts,
    });
  }
  return buildServiceReadinessSnapshot({
    env,
    databaseConfigured: true,
    databaseError: null,
    counts: database.counts,
    batchState: database.batchState,
    sourceReadiness: database.sourceReadiness,
    latestJobs: database.latestJobs,
    deepLinkAudit: database.deepLinkAudit,
    operationalHistory: database.operationalHistory,
    sourceCredentialRequirements: credentialSnapshot.requirements,
    sourceCredentialManifestEnv: credentialSnapshot.manifest_env,
    sourceCredentialManifestConfigured: credentialSnapshot.configured,
    sourceCredentialManifestError: credentialSnapshot.error,
    policyArtifacts,
    userExperienceArtifacts,
    launchArtifacts,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await auditServiceReadiness(args);
  const output = buildServiceReadinessCliOutput(snapshot);
  if (args.notify && output.status !== "ready") {
    output.notification = await notifyFailure(output);
  }
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== "ready") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Service readiness smoke failed.");
    console.error(err);
    process.exit(1);
  });
}
