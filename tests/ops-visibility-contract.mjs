import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichInternalServiceReadinessSnapshot,
  enrichInternalSourceReadinessSnapshot,
  redactServiceReadinessSnapshot,
  redactSourceReadinessSnapshot,
  resolveOpsRequestVisibility,
  sourceHealthUnavailablePayload,
} from "../lib/ops-visibility.ts";
import { buildServiceReadinessSnapshot } from "../lib/service-readiness.ts";
import { buildSourceReadinessSnapshot } from "../lib/source-readiness.ts";

const NOW = new Date("2026-05-29T03:00:00Z");

function serviceSnapshot() {
  return buildServiceReadinessSnapshot({
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-live-secret-123",
      KOREAN_AIR_FEED_API_KEY: "korean-air-live-secret-123",
      ASIANA_FEED_API_KEY: "asiana-live-secret-123",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example-prod.com/ops",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SUPPORT_EMAIL: "ops@example-prod.com",
    },
    now: NOW,
    databaseConfigured: true,
    databaseError: "password authentication failed for user sky_planner",
    counts: {
      places: 11,
      offers_active: 1000,
      deals_current_active: 120,
      source_health: 3,
    },
    batchState: {
      status: "success",
      last_batch_at: "2026-05-29T02:30:00Z",
      source_flags: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    },
    sourceReadiness: {
      status: "ready",
      source_flags: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
      blocked_source_ids: [],
      counts: {
        search_eligible_sources: 3,
        blocked_sources: 0,
        env_enabled_sources: 3,
      },
    },
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run/skyscanner_affiliate",
        offers_found: 50,
      },
    ],
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate"],
      valid_count_by_source: {
        skyscanner_affiliate: 8,
      },
    },
    operationalHistory: {
      window_days: 7,
      total_jobs: 7,
      success_count: 7,
      failure_count: 0,
      live_success_count: 7,
      success_rate: 1,
      live_success_source_ids: ["skyscanner_affiliate"],
    },
    sourceCredentialRequirements: {
      skyscanner_affiliate: ["SKYSCANNER_FEED_API_KEY"],
      korean_air_official: ["KOREAN_AIR_FEED_API_KEY"],
      asiana_official: ["ASIANA_FEED_API_KEY"],
    },
    policyArtifacts: {
      publicPolicyPage: true,
      affiliateDisclosure: true,
      dataAccuracyDisclosure: true,
      supportContactDisclosure: true,
      opsRunbook: true,
      readinessApi: true,
      readinessPage: true,
    },
    userExperienceArtifacts: {
      trustCues: true,
      serviceUnavailableUi: true,
    },
    launchArtifacts: {
      opsRunbook: true,
      envTemplate: true,
      runtimeEnvPreflight: true,
      contractTestGate: true,
      productionBuildGate: true,
	      productionManifestTemplate: true,
	      collectorWorkflow: true,
	      collectorArtifactUpload: true,
	      publicApiFallbackGuard: true,
	      prodReadinessGate: true,
      serviceReadinessGate: true,
      opsAlertGate: true,
      serviceLaunchAudit: true,
    },
  });
}

function credentialGapSnapshot() {
  const sourceIds = ["skyscanner_affiliate", "korean_air_official"];
  return buildServiceReadinessSnapshot({
    env: {
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-secret-value-123",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example-prod.com/ops",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SUPPORT_EMAIL: "ops@example-prod.com",
    },
    now: NOW,
    databaseConfigured: true,
    databaseError: null,
    counts: {
      places: 11,
      offers_active: 1000,
      deals_current_active: 120,
      source_health: 2,
    },
    batchState: {
      status: "success",
      last_batch_at: "2026-05-29T02:30:00Z",
      source_flags: sourceIds,
    },
    sourceReadiness: {
      status: "ready",
      source_flags: sourceIds,
      blocked_source_ids: [],
      counts: {
        search_eligible_sources: 2,
        blocked_sources: 0,
        env_enabled_sources: 2,
      },
    },
    latestJobs: sourceIds.map((sourceId) => ({
      source_id: sourceId,
      status: "success",
      parser_version: "authorized-json-feed-v1",
      artifact_prefix: `runtime/collector-artifacts/collector_run/${sourceId}`,
      offers_found: 50,
      completed_at: "2026-05-29T02:45:00Z",
    })),
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com", "www.koreanair.com"],
      source_ids_with_links: sourceIds,
      valid_count_by_source: {
        skyscanner_affiliate: 10,
        korean_air_official: 10,
      },
    },
    operationalHistory: {
      window_days: 7,
      total_jobs: 14,
      success_count: 14,
      failure_count: 0,
      live_success_count: 14,
      success_rate: 1,
      live_success_source_ids: sourceIds,
    },
    sourceCredentialRequirements: {
      skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
      korean_air_official: ["KOREAN_AIR_PARTNER_TOKEN"],
    },
    sourceCredentialManifestConfigured: true,
    policyArtifacts: {
      publicPolicyPage: true,
      affiliateDisclosure: true,
      dataAccuracyDisclosure: true,
      supportContactDisclosure: true,
      opsRunbook: true,
      readinessApi: true,
      readinessPage: true,
    },
    userExperienceArtifacts: {
      trustCues: true,
      serviceUnavailableUi: true,
    },
    launchArtifacts: {
      opsRunbook: true,
      envTemplate: true,
      runtimeEnvPreflight: true,
      contractTestGate: true,
      productionBuildGate: true,
	      productionManifestTemplate: true,
	      collectorWorkflow: true,
	      collectorArtifactUpload: true,
	      publicApiFallbackGuard: true,
	      prodReadinessGate: true,
      serviceReadinessGate: true,
      opsAlertGate: true,
      serviceLaunchAudit: true,
    },
  });
}

test("public service readiness redacts credential, webhook, support, and DB error details", () => {
  const redacted = redactServiceReadinessSnapshot(serviceSnapshot());
  const payload = JSON.stringify(redacted);

  assert.equal(redacted.visibility, "public");
  assert.doesNotMatch(payload, /SKYSCANNER_FEED_API_KEY/);
  assert.doesNotMatch(payload, /KOREAN_AIR_FEED_API_KEY/);
  assert.doesNotMatch(payload, /ASIANA_FEED_API_KEY/);
  assert.doesNotMatch(payload, /hooks\.example-prod\.com/);
  assert.doesNotMatch(payload, /ops@example-prod\.com/);
  assert.doesNotMatch(payload, /password authentication failed/);
  assert.doesNotMatch(payload, /collector_run\/skyscanner_affiliate/);
  assert.ok(redacted.operator_actions.some((item) => item.check === "live_collector_success"));
  assert.ok(redacted.operator_actions.some((item) => item.verify.includes("launch audit")));
});

test("public service readiness launch blockers avoid internal env names", () => {
  const redacted = redactServiceReadinessSnapshot(buildServiceReadinessSnapshot({
    env: {},
    now: NOW,
    databaseConfigured: false,
    databaseError: null,
  }));
  const payload = JSON.stringify(redacted);

  assert.doesNotMatch(payload, /OPS_ALERT_WEBHOOK_URL/);
  assert.doesNotMatch(payload, /OPS_READINESS_TOKEN/);
  assert.doesNotMatch(payload, /SUPPORT_EMAIL/);
  assert.ok(redacted.operator_actions.length > 0);
  assert.ok(redacted.operator_actions.some((item) => item.area === "런칭 운영"));
});

test("service readiness operator actions are ordered by cutover phase", () => {
  const redacted = redactServiceReadinessSnapshot(buildServiceReadinessSnapshot({
    env: {},
    now: NOW,
    databaseConfigured: false,
    databaseError: null,
  }));
  const internal = enrichInternalServiceReadinessSnapshot(buildServiceReadinessSnapshot({
    env: {},
    now: NOW,
    databaseConfigured: false,
    databaseError: null,
  }));
  const publicPriorities = redacted.operator_actions.map((item) => item.priority);
  const internalPriorities = internal.operator_actions.map((item) => item.priority);

  assert.deepEqual(publicPriorities, [...publicPriorities].sort((left, right) => left - right));
  assert.deepEqual(internalPriorities, [...internalPriorities].sort((left, right) => left - right));
  assert.equal(redacted.operator_actions[0].phase, "런타임/DB");
  assert.ok(redacted.operator_actions.some((item) => item.check === "collector_manifest_configured" && item.phase === "Source 설정"));
  assert.ok(redacted.operator_actions.some((item) => item.check === "live_collector_success" && item.phase === "Collector 증거"));
  assert.ok(
    redacted.operator_actions.findIndex((item) => item.check === "collector_manifest_configured") <
      redacted.operator_actions.findIndex((item) => item.check === "live_collector_success"),
  );
  assert.ok(
    redacted.operator_actions.findIndex((item) => item.check === "live_collector_success") <
      redacted.operator_actions.findIndex((item) => item.check === "booking_deeplink_sample_present"),
  );
});

test("internal service readiness adds operator actions with exact required env names", () => {
  const internal = enrichInternalServiceReadinessSnapshot(credentialGapSnapshot());
  const action = internal.operator_actions.find((item) => item.check === "source_credentials_present");
  const payload = JSON.stringify(internal);

  assert.equal(internal.visibility, "internal");
  assert.ok(action);
  assert.equal(action.phase, "Source 설정");
  assert.equal(action.priority, 21);
  assert.deepEqual(action.required_env, ["KOREAN_AIR_PARTNER_TOKEN", "SKYSCANNER_PARTNER_TOKEN"]);
  assert.deepEqual(action.affected_sources, ["korean_air_official", "skyscanner_affiliate"]);
  assert.deepEqual(action.reason, ["missing"]);
  assert.match(action.action, /16자 이상의 비-placeholder/);
  assert.match(action.verify, /preflight:service-env/);
  assert.match(payload, /KOREAN_AIR_PARTNER_TOKEN/);
  assert.doesNotMatch(payload, /skyscanner-secret-value-123/);
});

test("internal service readiness includes source health block reasons", () => {
  const internal = enrichInternalServiceReadinessSnapshot(buildServiceReadinessSnapshot({
    ...credentialGapSnapshot(),
    sourceReadiness: {
      status: "not_ready",
      source_flags: ["skyscanner_affiliate"],
      blocked_source_ids: ["korean_air_official"],
      readiness_blockers: ["insufficient_search_eligible_sources"],
      counts: {
        search_eligible_sources: 1,
        blocked_sources: 1,
        env_enabled_sources: 2,
      },
      sources: [
        {
          source_id: "skyscanner_affiliate",
          env_enabled: true,
          search_eligible: true,
          block_reason: null,
          env_flag: "SOURCE_SKYSCANNER_ENABLED",
        },
        {
          source_id: "korean_air_official",
          env_enabled: true,
          search_eligible: false,
          block_reason: "paused",
          env_flag: "SOURCE_KOREAN_AIR_ENABLED",
        },
      ],
    },
  }));
  const action = internal.operator_actions.find((item) => item.check === "source_health_ready");
  const sourceHealthCheck = internal.axes
    .find((axis) => axis.id === "operations_monitoring")
    .checks.find((item) => item.name === "source_health_ready");

  assert.ok(action);
  assert.deepEqual(action.affected_sources, ["korean_air_official"]);
  assert.deepEqual(action.reason, ["insufficient_search_eligible_sources", "paused"]);
  assert.ok(action.required_env.includes("DATABASE_URL"));
  assert.deepEqual(sourceHealthCheck.detail.source_block_reasons, [
    {
      source_id: "korean_air_official",
      reason: "paused",
      env_flag: "SOURCE_KOREAN_AIR_ENABLED",
    },
  ]);
});

test("public service readiness hides manifest token env names while keeping generic actions", () => {
  const redacted = redactServiceReadinessSnapshot(credentialGapSnapshot());
  const action = redacted.operator_actions.find((item) => item.check === "source_credentials_present");
  const payload = JSON.stringify(redacted);

  assert.ok(action);
  assert.equal(action.area, "수집 설정");
  assert.match(action.action, /16자 이상의 비-placeholder/);
  assert.doesNotMatch(payload, /KOREAN_AIR_PARTNER_TOKEN/);
  assert.doesNotMatch(payload, /SKYSCANNER_PARTNER_TOKEN/);
  assert.doesNotMatch(payload, /skyscanner-secret-value-123/);
});

test("public service readiness preserves broken deeplink rate without raw URLs", () => {
  const redacted = redactServiceReadinessSnapshot(buildServiceReadinessSnapshot({
    ...credentialGapSnapshot(),
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 2,
      distinct_hosts: ["localhost", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
      valid_count_by_source: {
        skyscanner_affiliate: 8,
        korean_air_official: 7,
        asiana_official: 5,
      },
    },
  }));
  const shapeCheck = redacted.axes
    .find((axis) => axis.id === "booking_conversion")
    .checks.find((item) => item.name === "booking_deeplink_shape");
  const payload = JSON.stringify(redacted);

  assert.equal(shapeCheck.status, "fail");
  assert.equal(shapeCheck.detail.invalid_count, 2);
  assert.equal(shapeCheck.detail.invalid_rate, 0.1);
  assert.equal(shapeCheck.detail.max_invalid_rate, 0.05);
  assert.equal(shapeCheck.detail.distinct_host_count, 2);
  assert.doesNotMatch(payload, /localhost/);
});

test("ops request visibility requires a configured bearer or x-header token", () => {
  const env = { OPS_READINESS_TOKEN: "ops-readiness-secret-123" };

  assert.equal(resolveOpsRequestVisibility(new Request("https://skyplanner.test/api/ops/service-readiness"), env).visibility, "public");
  assert.equal(resolveOpsRequestVisibility(new Request("https://skyplanner.test/api/ops/service-readiness", {
    headers: { authorization: "Bearer ops-readiness-secret-123" },
  }), env).visibility, "internal");
  assert.equal(resolveOpsRequestVisibility(new Request("https://skyplanner.test/api/ops/service-readiness", {
    headers: { "x-ops-readiness-token": "ops-readiness-secret-123" },
  }), env).visibility, "internal");
  assert.equal(resolveOpsRequestVisibility(new Request("https://skyplanner.test/api/ops/service-readiness"), {
    OPS_READINESS_TOKEN: "test",
  }).token_configured, false);
});

test("public source readiness redacts job errors and collector artifact prefixes", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: [
      {
        source_id: "skyscanner_affiliate",
        is_paused: false,
        enabled_by_flag: true,
        circuit_breaker_open: false,
        consecutive_failures: 0,
        last_success_at: "2026-05-29T02:50:00Z",
        last_artifact_prefix: "runtime/collector-artifacts/collector_run/skyscanner_affiliate",
      },
    ],
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        execution_id: "job_secret_1",
        status: "failed",
        parser_version: "authorized-json-feed-v1",
        failure_code: "auth_failed",
        last_error: "token SKYSCANNER_FEED_API_KEY rejected",
        created_at: "2026-05-29T02:50:00Z",
      },
    ],
    batchState: { status: "success", execution_id: "batch_1" },
    now: NOW,
    env: {},
  });

  const redacted = redactSourceReadinessSnapshot(snapshot);
  const payload = JSON.stringify(redacted);

  assert.equal(redacted.visibility, "public");
  assert.ok(redacted.operator_actions.length > 0);
  assert.doesNotMatch(payload, /collector-artifacts/);
  assert.doesNotMatch(payload, /SKYSCANNER_FEED_API_KEY/);
  assert.doesNotMatch(payload, /job_secret_1/);
  assert.doesNotMatch(payload, /SOURCE_SKYSCANNER_ENABLED/);
  assert.match(payload, /auth_failed/);
});

test("internal source readiness adds source-specific operator actions", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: [
      {
        source_id: "skyscanner_affiliate",
        is_paused: false,
        enabled_by_flag: true,
        circuit_breaker_open: false,
        consecutive_failures: 0,
        last_success_at: "2026-05-27T02:50:00Z",
      },
      {
        source_id: "korean_air_official",
        is_paused: true,
        enabled_by_flag: true,
        last_success_at: "2026-05-29T02:50:00Z",
      },
    ],
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        execution_id: "job_1",
        status: "failed",
        parser_version: "authorized-json-feed-v1",
        failure_code: "auth_failed",
        last_error: "token rejected",
        created_at: "2026-05-29T02:50:00Z",
      },
    ],
    batchState: { status: "failed", execution_id: "batch_1" },
    now: NOW,
    env: { SOURCE_MAX_STALE_HOURS: "24" },
  });

  const internal = enrichInternalSourceReadinessSnapshot(snapshot);
  const staleAction = internal.operator_actions.find((item) => item.source_id === "skyscanner_affiliate");
  const pausedAction = internal.operator_actions.find((item) => item.source_id === "korean_air_official");
  const batchAction = internal.operator_actions.find((item) => item.area === "collector batch");

  assert.equal(internal.visibility, "internal");
  assert.ok(batchAction);
  assert.ok(staleAction);
  assert.equal(staleAction.reason, "stale");
  assert.equal(staleAction.env_flag, "SOURCE_SKYSCANNER_ENABLED");
  assert.equal(staleAction.latest_failure_code, "auth_failed");
  assert.ok(staleAction.required_env.includes("DATABASE_URL"));
  assert.match(staleAction.verify, /audit:service-launch/);
  assert.match(staleAction.verify, /--verify-release-gates/);
  assert.ok(pausedAction);
  assert.equal(pausedAction.reason, "paused");
  assert.ok(pausedAction.required_env.includes("DATABASE_URL"));
  assert.match(pausedAction.verify, /--database-url \[REDACTED_DATABASE_URL\]/);
  assert.ok(batchAction.required_env.includes("COLLECTOR_SOURCE_MANIFEST_JSON"));
  assert.match(batchAction.verify, /--verify-release-gates/);
});

test("source readiness operator actions surface strict source env blockers", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: [],
    batchState: { status: "success" },
    now: NOW,
    env: {
      SERVICE_REQUIRE_POSTGRES: "true",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "maybe",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_MAX_STALE_HOURS: "",
    },
  });
  const internal = enrichInternalSourceReadinessSnapshot(snapshot);
  const killSwitchAction = internal.operator_actions.find((item) => item.reason === "source_kill_switches_invalid");
  const staleWindowAction = internal.operator_actions.find((item) => item.reason === "source_max_stale_hours_invalid");

  assert.equal(internal.status, "not_ready");
  assert.ok(killSwitchAction);
  assert.equal(killSwitchAction.area, "source policy");
  assert.ok(killSwitchAction.required_env.includes("SOURCE_KOREAN_AIR_ENABLED"));
  assert.match(killSwitchAction.verify, /preflight:runtime-env/);
  assert.ok(staleWindowAction);
  assert.deepEqual(staleWindowAction.required_env, ["SOURCE_MAX_STALE_HOURS"]);
});

test("public source readiness keeps safe strict source env actions", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: [],
    batchState: { status: "success" },
    now: NOW,
    env: {
      SERVICE_REQUIRE_POSTGRES: "true",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "maybe",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_MAX_STALE_HOURS: "",
    },
  });
  const redacted = redactSourceReadinessSnapshot(snapshot);
  const payload = JSON.stringify(redacted);
  const killSwitchAction = redacted.operator_actions.find((item) => item.reason === "source_kill_switches_invalid");
  const staleWindowAction = redacted.operator_actions.find((item) => item.reason === "source_max_stale_hours_invalid");

  assert.equal(redacted.visibility, "public");
  assert.ok(killSwitchAction);
  assert.equal(killSwitchAction.area, "source policy");
  assert.match(killSwitchAction.verify, /runtime env preflight/);
  assert.ok(staleWindowAction);
  assert.deepEqual(redacted.readiness_blockers, [
    "source_kill_switches_invalid",
    "source_max_stale_hours_invalid",
    "insufficient_search_eligible_sources",
  ]);
  assert.doesNotMatch(payload, /SOURCE_KOREAN_AIR_ENABLED/);
  assert.doesNotMatch(payload, /SOURCE_MAX_STALE_HOURS/);
});

test("source health unavailable payload hides DB and credential errors publicly", () => {
  const publicPayload = sourceHealthUnavailablePayload("public", {
    generatedAt: "2026-05-29T03:00:00.000Z",
    reason: "source_health_query_failed",
    error: "password authentication failed for postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
  });
  const internalPayload = sourceHealthUnavailablePayload("internal", {
    generatedAt: "2026-05-29T03:00:00.000Z",
    reason: "source_health_query_failed",
    error: "password authentication failed",
  });
  const publicText = JSON.stringify(publicPayload);

  assert.equal(publicPayload.status, "not_ready");
  assert.equal(publicPayload.visibility, "public");
  assert.equal(publicPayload.message, "collector source health is unavailable.");
  assert.ok(publicPayload.operator_actions.length > 0);
  assert.doesNotMatch(publicText, /password/i);
  assert.doesNotMatch(publicText, /secret/i);
  assert.doesNotMatch(publicText, /sky_planner/i);
  assert.equal(internalPayload.visibility, "internal");
  assert.equal(internalPayload.error, "source_health_query_failed");
  assert.equal(internalPayload.detail, "password authentication failed");
  assert.ok(internalPayload.operator_actions[0].verify.includes("source-health"));
  assert.ok(internalPayload.operator_actions[0].verify.includes("--database-url [REDACTED_DATABASE_URL]"));
  assert.deepEqual(internalPayload.operator_actions[0].required_env, ["DATABASE_URL"]);
});

test("public source health unavailable action routes missing DB config to runtime preflight", () => {
  const publicPayload = sourceHealthUnavailablePayload("public", {
    generatedAt: "2026-05-29T03:00:00.000Z",
    reason: "database_url_missing",
    error: "DATABASE_URL is required for collector source health.",
  });
  const payload = JSON.stringify(publicPayload);

  assert.equal(publicPayload.visibility, "public");
  assert.equal(publicPayload.operator_actions[0].reason, "source_health_unavailable");
  assert.match(publicPayload.operator_actions[0].verify, /runtime env preflight/);
  assert.doesNotMatch(payload, /DATABASE_URL/);
});
