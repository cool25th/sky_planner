import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sourceCredentialRequirementsFromManifestEnv } from "../lib/service-credential-requirements.ts";
import { buildServiceReadinessSnapshot, serviceSourceScope } from "../lib/service-readiness.ts";
import {
  auditServiceReadiness,
  buildServiceReadinessAlertPayload,
  buildServiceReadinessCliOutput,
  deepLinkAudit,
} from "../scripts/service-readiness-smoke.mjs";

const NOW = new Date("2026-05-29T03:00:00Z");

function readyInput(overrides = {}) {
  return {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-live-secret-123",
      KOREAN_AIR_FEED_API_KEY: "korean-air-live-secret-123",
      ASIANA_FEED_API_KEY: "asiana-live-secret-123",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example-prod.com/ops",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SOURCE_MAX_STALE_HOURS: "24",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "true",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
      SUPPORT_EMAIL: "ops@example-prod.com",
    },
    now: NOW,
    databaseConfigured: true,
    databaseError: null,
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
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/skyscanner_affiliate",
        offers_found: 50,
      },
      {
        source_id: "korean_air_official",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/korean_air_official",
        offers_found: 40,
      },
      {
        source_id: "asiana_official",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/asiana_official",
        offers_found: 35,
      },
    ],
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
      valid_count_by_source: {
        skyscanner_affiliate: 8,
        korean_air_official: 7,
        asiana_official: 5,
      },
    },
    operationalHistory: {
      window_days: 7,
      total_jobs: 21,
      success_count: 21,
      failure_count: 0,
      live_success_count: 21,
      success_rate: 1,
      live_success_source_ids: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    },
    sourceCredentialManifestEnv: "COLLECTOR_SOURCE_MANIFEST_JSON",
    sourceCredentialManifestConfigured: true,
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
    ...overrides,
  };
}

test("service readiness is ready only when all six service axes pass", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput());

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.axes.length, 6);
  assert.equal(snapshot.summary.failed, 0);
  assert.deepEqual(snapshot.axes.map((axis) => axis.status), ["pass", "pass", "pass", "pass", "pass", "pass"]);
});

test("service readiness blocks launch for local mock data and missing credentials", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {},
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        status: "success",
        parser_version: "local-mock-v1",
      },
    ],
  }));
  const failedChecks = snapshot.summary.failed_checks;
  const liveCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "live_collector_success");

  assert.equal(snapshot.status, "not_ready");
  assert.ok(failedChecks.includes("live_collector_success"));
  assert.ok(failedChecks.includes("source_credentials_present"));
  assert.ok(failedChecks.includes("alert_channel_configured"));
  assert.ok(failedChecks.includes("support_contact_configured"));
  assert.ok(failedChecks.includes("ops_readiness_token_configured"));
  assert.ok(liveCheck.detail.missing.some((item) => (
    item.source_id === "skyscanner_affiliate" && item.reason === "mock_parser_version"
  )));
});

test("service readiness requires service unavailable UI on public fare surfaces", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    userExperienceArtifacts: {
      trustCues: true,
      serviceUnavailableUi: false,
    },
  }));
  const uxAxis = snapshot.axes.find((axis) => axis.id === "user_experience");
  const check = uxAxis.checks.find((item) => item.name === "service_unavailable_ui_available");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(uxAxis.status, "fail");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail.surfaces, ["/", "/map", "/offers", "/destination/[placeId]"]);
});

test("service readiness requires policy support contact disclosure without placeholders", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    policyArtifacts: {
      ...readyInput().policyArtifacts,
      supportContactDisclosure: false,
    },
  }));
  const policyAxis = snapshot.axes.find((axis) => axis.id === "policy_compliance");
  const check = policyAxis.checks.find((item) => item.name === "support_contact_disclosure");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(policyAxis.status, "fail");
  assert.equal(check.status, "fail");
});

test("service readiness does not mark the read model queryable without database config", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    databaseConfigured: false,
    databaseError: null,
  }));
  const dataAxis = snapshot.axes.find((axis) => axis.id === "data_supply");
  const configuredCheck = dataAxis.checks.find((check) => check.name === "postgres_read_model_configured");
  const queryableCheck = dataAxis.checks.find((check) => check.name === "postgres_read_model_queryable");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(configuredCheck.status, "fail");
  assert.equal(queryableCheck.status, "fail");
  assert.equal(queryableCheck.detail.reason, "database_url_missing");
});

test("service readiness smoke reports missing database URL as a readiness blocker", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    env: {},
    launchArtifacts: readyInput().launchArtifacts,
  });
  const dataAxis = snapshot.axes.find((axis) => axis.id === "data_supply");
  const configuredCheck = dataAxis.checks.find((check) => check.name === "postgres_read_model_configured");
  const queryableCheck = dataAxis.checks.find((check) => check.name === "postgres_read_model_queryable");

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("postgres_read_model_configured"));
  assert.ok(snapshot.summary.failed_checks.includes("postgres_read_model_queryable"));
  assert.equal(configuredCheck.status, "fail");
  assert.equal(queryableCheck.detail.reason, "database_url_missing");
});

test("service readiness CLI output includes ordered operator actions", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    env: {},
    launchArtifacts: readyInput().launchArtifacts,
  });
  const output = buildServiceReadinessCliOutput(snapshot);
  const priorities = output.operator_actions.map((item) => item.priority);

  assert.equal(output.visibility, "internal");
  assert.deepEqual(priorities, [...priorities].sort((left, right) => left - right));
  assert.equal(output.operator_actions[0].phase, "런타임/DB");
  assert.ok(output.operator_actions.some((item) => item.check === "collector_manifest_configured" && item.phase === "Source 설정"));
  assert.ok(output.operator_actions.some((item) => item.check === "live_collector_success" && item.phase === "Collector 증거"));
  assert.ok(output.operator_actions.some((item) => item.check === "booking_deeplink_sample_present" && item.phase === "예약 전환"));
  assert.ok(output.operator_actions.find((item) => item.check === "postgres_read_model_configured").required_env.includes("DATABASE_URL"));
});

test("service readiness deeplink audit samples every active source independently", async () => {
  const calls = [];
  const client = {
    async query(_sql, params) {
      const sourceKeys = params[0];
      calls.push(sourceKeys);
      if (sourceKeys.includes("skyscanner_affiliate")) {
        return {
          rows: Array.from({ length: 6 }, (_, index) => ({
            deep_link: `https://www.skyscanner.com/transport/flights/icn/nrt?sample=${index}`,
            booking_source: "skyscanner_affiliate",
          })),
        };
      }
      if (sourceKeys.includes("korean_air_official")) {
        return {
          rows: [
            ...Array.from({ length: 5 }, (_, index) => ({
              deep_link: `https://www.koreanair.com/booking/search?sample=${index}`,
              booking_source: "korean_air_official",
            })),
            {
              deep_link: "https://www.koreanair.com/booking/search?sample=0#duplicate",
              booking_source: "korean_air_official",
            },
            {
              deep_link: "https://www.koreanair.com/booking/search?utm_source=ops&sample=0",
              booking_source: "korean_air_official",
            },
            {
              deep_link: "https://www.koreanair.com/booking/search?sample=1&gclid=tracking-id",
              booking_source: "korean_air_official",
            },
            {
              deep_link: "http://localhost:3000/booking",
              booking_source: "korean_air_official",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const audit = await deepLinkAudit(client, ["skyscanner_affiliate", "korean_air_official"], 40);

  assert.equal(calls.length, 2);
  assert.ok(calls.some((sourceKeys) => sourceKeys.includes("skyscanner")));
  assert.ok(calls.some((sourceKeys) => sourceKeys.includes("ke")));
  assert.equal(audit.sample_size, 15);
  assert.equal(audit.invalid_count, 1);
  assert.deepEqual(audit.source_ids_with_links, ["korean_air_official", "skyscanner_affiliate"]);
  assert.deepEqual(audit.valid_count_by_source, {
    korean_air_official: 5,
    skyscanner_affiliate: 6,
  });
});

test("service readiness smoke requires strict launch audit evidence fields", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    env: {},
  });
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");
  const auditCheck = launchAxis.checks.find((check) => check.name === "service_launch_audit_available");
  const productionGateCheck = launchAxis.checks.find((check) => check.name === "production_gate_available");
  const serviceGateCheck = launchAxis.checks.find((check) => check.name === "service_gate_available");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(productionGateCheck.status, "pass");
  assert.equal(serviceGateCheck.status, "pass");
  assert.equal(auditCheck.status, "pass");
  assert.equal(auditCheck.detail.script, "scripts/service-launch-audit.mjs");
  assert.equal(auditCheck.detail.output_dir, "runtime/service-launch-audits");
  assert.equal(auditCheck.detail.evidence_checklist, true);
  assert.deepEqual(auditCheck.detail.required_evidence, [
    "release_gate",
    "alert_delivery",
    "collector_cutover",
    "collector_history_7d",
    "deeplink_samples",
    "persisted_launch_report",
  ]);
});

test("service readiness smoke accepts a non-default collector manifest env", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    manifestEnv: "PROD_SOURCE_MANIFEST_JSON",
    env: {
      PROD_SOURCE_MANIFEST_JSON: JSON.stringify({
        schema_version: "collector.source_manifest.v1",
        sources: [
          {
            config: {
              source_id: "skyscanner_affiliate",
              auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
            },
          },
        ],
      }),
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
    },
    launchArtifacts: readyInput().launchArtifacts,
  });
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(credentialCheck.status, "pass");
  assert.equal(credentialCheck.detail.requirement_source, "collector_manifest");
  assert.deepEqual(credentialCheck.detail.env_names_by_source, {
    skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
  });
});

test("service readiness blocks missing collector manifest env", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    manifestEnv: "PROD_SOURCE_MANIFEST_JSON",
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-live-secret-123",
      KOREAN_AIR_FEED_API_KEY: "korean-air-live-secret-123",
      ASIANA_FEED_API_KEY: "asiana-live-secret-123",
    },
    launchArtifacts: readyInput().launchArtifacts,
  });
  const manifestCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "collector_manifest_configured");

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("collector_manifest_configured"));
  assert.equal(manifestCheck.status, "fail");
  assert.equal(manifestCheck.detail.manifest_env, "PROD_SOURCE_MANIFEST_JSON");
  assert.equal(manifestCheck.detail.reason, "missing");
});

test("service readiness blocks placeholder source credentials", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...readyInput().env,
      SKYSCANNER_FEED_API_KEY: "replace-me",
      KOREAN_AIR_FEED_API_KEY: "test",
    },
  }));
  const dataAxis = snapshot.axes.find((axis) => axis.id === "data_supply");
  const credentialCheck = dataAxis.checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("source_credentials_present"));
  assert.equal(credentialCheck.status, "fail");
  assert.ok(credentialCheck.detail.missing.some((item) => item.reason === "placeholder_value"));
});

test("service readiness blocks too-short source credentials", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...readyInput().env,
      SKYSCANNER_FEED_API_KEY: "short-secret",
    },
  }));
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("source_credentials_present"));
  assert.equal(credentialCheck.status, "fail");
  assert.ok(credentialCheck.detail.missing.some((item) => (
    item.source_id === "skyscanner_affiliate" &&
    item.env_name === "SKYSCANNER_FEED_API_KEY" &&
    item.reason === "too_short"
  )));
});

test("service readiness uses collector manifest token env credentials", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
      KOREAN_AIR_PARTNER_TOKEN: "korean-air-live-secret-123",
      ASIANA_PARTNER_TOKEN: "asiana-live-secret-123",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example-prod.com/ops",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SOURCE_MAX_STALE_HOURS: "24",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "true",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
      SUPPORT_EMAIL: "ops@example-prod.com",
    },
    sourceCredentialRequirements: {
      skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
      korean_air_official: ["KOREAN_AIR_PARTNER_TOKEN"],
      asiana_official: ["ASIANA_PARTNER_TOKEN"],
    },
  }));
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "ready");
  assert.equal(credentialCheck.status, "pass");
  assert.equal(credentialCheck.detail.requirement_source, "collector_manifest");
});

test("service readiness allows manifest promo page sources without credential secrets", () => {
  const input = readyInput();
  const sourceIds = [
    "skyscanner_affiliate",
    "korean_air_official",
    "asiana_official",
    "official_promo_pages",
  ];
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    sourceCredentialRequirements: {
      ...input.sourceCredentialRequirements,
      official_promo_pages: [],
    },
    counts: {
      ...input.counts,
      source_health: 4,
    },
    batchState: {
      ...input.batchState,
      source_flags: sourceIds,
    },
    sourceReadiness: {
      status: "ready",
      source_flags: sourceIds,
      blocked_source_ids: [],
      counts: {
        search_eligible_sources: 4,
        blocked_sources: 0,
        env_enabled_sources: 4,
      },
    },
    latestJobs: [
      ...input.latestJobs,
      {
        source_id: "official_promo_pages",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/official_promo_pages",
        offers_found: 12,
      },
    ],
    deepLinkAudit: {
      ...input.deepLinkAudit,
      distinct_hosts: [...input.deepLinkAudit.distinct_hosts, "www.google.com"],
      source_ids_with_links: sourceIds,
      valid_count_by_source: {
        ...input.deepLinkAudit.valid_count_by_source,
        official_promo_pages: 5,
      },
    },
    operationalHistory: {
      ...input.operationalHistory,
      total_jobs: 28,
      success_count: 28,
      live_success_count: 28,
      live_success_source_ids: sourceIds,
    },
  }));
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "ready");
  assert.equal(credentialCheck.status, "pass");
  assert.deepEqual(credentialCheck.detail.env_names_by_source.official_promo_pages, []);
});

test("service readiness blocks malformed collector manifest credentials", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    sourceCredentialManifestError: "Unexpected token",
  }));
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(credentialCheck.status, "fail");
  assert.equal(credentialCheck.detail.reason, "manifest_parse_error");
});

test("service readiness fails when manifest omits an active source token env", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    sourceCredentialRequirements: {
      skyscanner_affiliate: ["SKYSCANNER_FEED_API_KEY"],
    },
  }));
  const credentialCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(credentialCheck.status, "fail");
  assert.ok(credentialCheck.detail.missing.some((item) => (
    item.source_id === "korean_air_official" && item.reason === "missing_token_env"
  )));
  assert.ok(credentialCheck.detail.missing.some((item) => (
    item.source_id === "asiana_official" && item.reason === "missing_token_env"
  )));
});

test("collector manifest credential extractor reads active inline token env names", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
      schema_version: "collector.source_manifest.v1",
      sources: [
        {
          config: {
            source_id: "skyscanner_affiliate",
            auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
          },
        },
        {
          enabled: false,
          config: {
            source_id: "disabled_source",
            auth: { token_env: "DISABLED_TOKEN" },
          },
        },
      ],
    }),
  });

  assert.equal(snapshot.error, null);
  assert.equal(snapshot.configured, true);
  assert.deepEqual(snapshot.requirements, {
    skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
  });
});

test("collector manifest credential extractor allows promo page sources without auth", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
      schema_version: "collector.source_manifest.v1",
      sources: [
        {
          config: {
            source_id: "google_flights_direct",
            source_type: "promo_page",
          },
        },
      ],
    }),
  });

  assert.equal(snapshot.error, null);
  assert.equal(snapshot.configured, true);
  assert.deepEqual(snapshot.requirements, {
    google_flights_direct: [],
  });
});

test("collector manifest credential extractor rejects non-promo sources without auth", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
      schema_version: "collector.source_manifest.v1",
      sources: [
        {
          config: {
            source_id: "skyscanner_affiliate",
            source_type: "meta_search",
          },
        },
      ],
    }),
  });

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.requirements, null);
  assert.match(snapshot.error, /non-promo config must provide auth\.token_env/);
});

test("collector manifest credential extractor resolves active config path token env names", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-credential-manifest-"));
  try {
    await writeFile(path.join(tmpRoot, "source.json"), `${JSON.stringify({
      schema_version: "collector.authorized_feed_source.v1",
      source_id: "skyscanner_affiliate",
      source_type: "meta_search",
      endpoint: "https://partner.example-prod.com/fares",
      auth: { header_name: "Authorization", token_env: "SKYSCANNER_PARTNER_TOKEN" },
    }, null, 2)}\n`);
    await writeFile(path.join(tmpRoot, "disabled-source.json"), `${JSON.stringify({
      schema_version: "collector.authorized_feed_source.v1",
      source_id: "disabled_source",
      source_type: "meta_search",
      endpoint: "https://partner.example-prod.com/disabled",
      auth: { header_name: "Authorization", token_env: "DISABLED_TOKEN" },
    }, null, 2)}\n`);

    const snapshot = sourceCredentialRequirementsFromManifestEnv({
      COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
        schema_version: "collector.source_manifest.v1",
        sources: [
          { config_path: "source.json" },
          { enabled: false, config_path: "disabled-source.json" },
        ],
      }),
    }, "COLLECTOR_SOURCE_MANIFEST_JSON", { baseDir: tmpRoot });

    assert.equal(snapshot.error, null);
    assert.equal(snapshot.configured, true);
    assert.deepEqual(snapshot.requirements, {
      skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
    });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("collector manifest credential extractor rejects malformed source selectors", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
      schema_version: "collector.source_manifest.v1",
      sources: [
        {
          config_path: "source.json",
          config: {
            source_id: "skyscanner_affiliate",
            auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
          },
        },
      ],
    }),
  });

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.requirements, null);
  assert.match(snapshot.error, /exactly one of config or config_path/);
});

test("collector manifest credential extractor rejects duplicate active source ids", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
      schema_version: "collector.source_manifest.v1",
      sources: [
        {
          config: {
            source_id: "skyscanner_affiliate",
            auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
          },
        },
        {
          config: {
            source_id: "skyscanner_affiliate",
            auth: { token_env: "SKYSCANNER_SECONDARY_TOKEN" },
          },
        },
      ],
    }),
  });

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.requirements, null);
  assert.match(snapshot.error, /duplicates active config\.source_id skyscanner_affiliate/);
});

test("service readiness blocks malformed collector manifest selectors", async () => {
  const snapshot = await auditServiceReadiness({
    databaseUrl: "",
    env: {
      COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
        schema_version: "collector.source_manifest.v1",
        sources: [
          {
            config: {
              auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
            },
          },
        ],
      }),
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
    },
    launchArtifacts: readyInput().launchArtifacts,
  });
  const dataAxis = snapshot.axes.find((axis) => axis.id === "data_supply");
  const manifestCheck = dataAxis.checks.find((check) => check.name === "collector_manifest_configured");
  const credentialCheck = dataAxis.checks.find((check) => check.name === "source_credentials_present");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(manifestCheck.status, "fail");
  assert.equal(manifestCheck.detail.reason, "manifest_parse_error");
  assert.match(manifestCheck.detail.error, /missing config\.source_id/);
  assert.equal(credentialCheck.status, "fail");
  assert.equal(credentialCheck.detail.reason, "manifest_parse_error");
});

test("service readiness smoke uses config path manifest credentials", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-readiness-manifest-"));
  try {
    const sourcePath = path.join(tmpRoot, "source.json");
    await writeFile(sourcePath, `${JSON.stringify({
      schema_version: "collector.authorized_feed_source.v1",
      source_id: "skyscanner_affiliate",
      source_type: "meta_search",
      endpoint: "https://partner.example-prod.com/fares",
      auth: { header_name: "Authorization", token_env: "SKYSCANNER_PARTNER_TOKEN" },
    }, null, 2)}\n`);

    const snapshot = await auditServiceReadiness({
      databaseUrl: "",
      env: {
        COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify({
          schema_version: "collector.source_manifest.v1",
          sources: [
            { config_path: sourcePath },
          ],
        }),
        SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
      },
      launchArtifacts: readyInput().launchArtifacts,
    });
    const credentialCheck = snapshot.axes
      .find((axis) => axis.id === "data_supply")
      .checks.find((check) => check.name === "source_credentials_present");

    assert.equal(snapshot.status, "not_ready");
    assert.equal(credentialCheck.status, "pass");
    assert.deepEqual(credentialCheck.detail.env_names_by_source, {
      skyscanner_affiliate: ["SKYSCANNER_PARTNER_TOKEN"],
    });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("collector manifest credential extractor marks a missing manifest env", () => {
  const snapshot = sourceCredentialRequirementsFromManifestEnv({}, "PROD_SOURCE_MANIFEST_JSON");

  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.manifest_env, "PROD_SOURCE_MANIFEST_JSON");
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.requirements, null);
});

test("service readiness blocks live collector claims without collector artifact refs", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "",
      },
      {
        source_id: "korean_air_official",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "local://collector-contract/20260529T023000Z",
      },
      {
        source_id: "asiana_official",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/asiana_official",
      },
    ],
  }));

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("live_collector_success"));
  const liveCheck = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((check) => check.name === "live_collector_success");
  assert.deepEqual(liveCheck.detail.missing.map((item) => [item.source_id, item.reason]), [
    ["korean_air_official", "missing_live_artifact_ref"],
    ["skyscanner_affiliate", "missing_live_artifact_ref"],
  ]);
});

test("service readiness blocks placeholder webhook and support contact", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...readyInput().env,
      OPS_ALERT_WEBHOOK_URL: "http://localhost:3000/alerts",
      SUPPORT_EMAIL: "support@example.com",
    },
  }));
  const failedChecks = snapshot.summary.failed_checks;

  assert.equal(snapshot.status, "not_ready");
  assert.ok(failedChecks.includes("alert_channel_configured"));
  assert.ok(failedChecks.includes("support_contact_configured"));
});

test("service readiness fails operations when 7 day collector history is insufficient", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    operationalHistory: {
      window_days: 7,
      total_jobs: 3,
      success_count: 3,
      failure_count: 0,
      live_success_count: 3,
      success_rate: 1,
      live_success_source_ids: ["skyscanner_affiliate"],
    },
  }));
  const operationsAxis = snapshot.axes.find((axis) => axis.id === "operations_monitoring");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(operationsAxis.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("collector_success_rate_7d"));
});

test("service readiness requires latest batch to include active source scope", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    batchState: {
      status: "success",
      last_batch_at: "2026-05-29T02:30:00Z",
      source_flags: ["skyscanner_affiliate"],
    },
  }));
  const check = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((item) => item.name === "last_batch_source_coverage");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail.missing_source_ids, [
    "asiana_official",
    "korean_air_official",
  ]);
});

test("service readiness exposes source health block reasons for internal operators", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    sourceReadiness: {
      status: "not_ready",
      source_flags: ["skyscanner_affiliate"],
      blocked_source_ids: ["korean_air_official", "asiana_official"],
      readiness_blockers: ["insufficient_search_eligible_sources"],
      counts: {
        search_eligible_sources: 1,
        blocked_sources: 2,
        env_enabled_sources: 3,
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
        {
          source_id: "asiana_official",
          env_enabled: true,
          search_eligible: false,
          block_reason: "circuit_breaker_open",
          env_flag: "SOURCE_ASIANA_ENABLED",
        },
      ],
    },
  }));
  const check = snapshot.axes
    .find((axis) => axis.id === "operations_monitoring")
    .checks.find((item) => item.name === "source_health_ready");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail.readiness_blockers, ["insufficient_search_eligible_sources"]);
  assert.deepEqual(check.detail.source_block_reasons, [
    {
      source_id: "korean_air_official",
      reason: "paused",
      env_flag: "SOURCE_KOREAN_AIR_ENABLED",
    },
    {
      source_id: "asiana_official",
      reason: "circuit_breaker_open",
      env_flag: "SOURCE_ASIANA_ENABLED",
    },
  ]);
});

test("service readiness checks credentials and live evidence for env-enabled blocked sources", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-live-secret-123",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example-prod.com/ops",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SUPPORT_EMAIL: "ops@example-prod.com",
    },
    sourceReadiness: {
      status: "not_ready",
      source_flags: ["skyscanner_affiliate"],
      blocked_source_ids: ["korean_air_official", "asiana_official"],
      readiness_blockers: ["insufficient_search_eligible_sources"],
      counts: {
        search_eligible_sources: 1,
        blocked_sources: 2,
        env_enabled_sources: 3,
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
        {
          source_id: "asiana_official",
          env_enabled: true,
          search_eligible: false,
          block_reason: "stale",
          env_flag: "SOURCE_ASIANA_ENABLED",
        },
      ],
    },
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/skyscanner_affiliate",
      },
    ],
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com"],
      source_ids_with_links: ["skyscanner_affiliate"],
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
  }));
  const dataAxis = snapshot.axes.find((axis) => axis.id === "data_supply");
  const liveCheck = dataAxis.checks.find((item) => item.name === "live_collector_success");
  const credentialCheck = dataAxis.checks.find((item) => item.name === "source_credentials_present");
  const historyCheck = snapshot.axes
    .find((axis) => axis.id === "operations_monitoring")
    .checks.find((item) => item.name === "collector_success_rate_7d");
  const bookingCoverageCheck = snapshot.axes
    .find((axis) => axis.id === "booking_conversion")
    .checks.find((item) => item.name === "booking_deeplink_source_coverage");

  assert.equal(snapshot.status, "not_ready");
  assert.deepEqual(liveCheck.detail.missing_source_ids, [
    "asiana_official",
    "korean_air_official",
  ]);
  assert.ok(credentialCheck.detail.missing.some((item) => (
    item.source_id === "korean_air_official" && item.reason === "missing"
  )));
  assert.ok(credentialCheck.detail.missing.some((item) => (
    item.source_id === "asiana_official" && item.reason === "missing"
  )));
  assert.deepEqual(historyCheck.detail.missing_live_source_ids, [
    "asiana_official",
    "korean_air_official",
  ]);
  assert.deepEqual(bookingCoverageCheck.detail.missing_source_ids, [
    "asiana_official",
    "korean_air_official",
  ]);
});

test("service evidence source scope includes env-enabled and manifest-active sources", () => {
  const scope = serviceSourceScope({
    status: "not_ready",
    source_flags: ["skyscanner_affiliate"],
    sources: [
      {
        source_id: "skyscanner_affiliate",
        env_enabled: true,
        search_eligible: true,
      },
      {
        source_id: "korean_air_official",
        env_enabled: true,
        search_eligible: false,
        block_reason: "paused",
      },
      {
        source_id: "asiana_official",
        env_enabled: false,
        search_eligible: false,
        block_reason: "disabled_by_env",
      },
    ],
  }, {
    asiana_official: ["ASIANA_PARTNER_TOKEN"],
    partner_x: ["PARTNER_X_TOKEN"],
  });

  assert.deepEqual(scope, [
    "asiana_official",
    "korean_air_official",
    "partner_x",
    "skyscanner_affiliate",
  ]);
});

test("service readiness blocks manifest sources missing source policy catalog entries", () => {
  const input = readyInput();
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...input.env,
      UNKNOWN_PARTNER_TOKEN: "unknown-partner-live-secret-123",
    },
    sourceCredentialRequirements: {
      ...input.sourceCredentialRequirements,
      unknown_partner: ["UNKNOWN_PARTNER_TOKEN"],
    },
    latestJobs: [
      ...input.latestJobs,
      {
        source_id: "unknown_partner",
        status: "success",
        parser_version: "authorized-json-feed-v1",
        artifact_prefix: "runtime/collector-artifacts/collector_run_20260529T023000Z/unknown_partner",
        offers_found: 10,
      },
    ],
    deepLinkAudit: {
      ...input.deepLinkAudit,
      source_ids_with_links: [...input.deepLinkAudit.source_ids_with_links, "unknown_partner"],
    },
    operationalHistory: {
      ...input.operationalHistory,
      total_jobs: 28,
      success_count: 28,
      live_success_count: 28,
      live_success_source_ids: [...input.operationalHistory.live_success_source_ids, "unknown_partner"],
    },
  }));
  const check = snapshot.axes
    .find((axis) => axis.id === "data_supply")
    .checks.find((item) => item.name === "source_policy_catalog_coverage");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail.unknown_source_ids, ["unknown_partner"]);
  assert.deepEqual(check.detail.required_policy_fields, ["env_flag", "default_enabled", "booking_source_keys"]);
});

test("service readiness fails operations when collector success rate is below 95 percent", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    operationalHistory: {
      window_days: 7,
      total_jobs: 21,
      success_count: 19,
      failure_count: 2,
      live_success_count: 19,
      success_rate: 19 / 21,
      live_success_source_ids: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    },
  }));

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("collector_success_rate_7d"));
});

test("service readiness fails booking conversion when deeplink sample is invalid", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 2,
      distinct_hosts: ["localhost", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    },
  }));
  const bookingAxis = snapshot.axes.find((axis) => axis.id === "booking_conversion");
  const shapeCheck = bookingAxis.checks.find((item) => item.name === "booking_deeplink_shape");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(bookingAxis.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("booking_deeplink_shape"));
  assert.equal(shapeCheck.detail.sample_size, 20);
  assert.equal(shapeCheck.detail.invalid_count, 2);
  assert.equal(shapeCheck.detail.invalid_rate, 0.1);
  assert.equal(shapeCheck.detail.max_invalid_rate, 0.05);
  assert.equal(shapeCheck.detail.reason, "broken_deeplink_rate_above_threshold");
});

test("service readiness alert payload includes broken link and collector metrics", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
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
    operationalHistory: {
      window_days: 7,
      total_jobs: 21,
      success_count: 19,
      failure_count: 2,
      live_success_count: 19,
      success_rate: 19 / 21,
      live_success_source_ids: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    },
  }));
  const payload = buildServiceReadinessAlertPayload(snapshot);
  const serialized = JSON.stringify(payload);

  assert.equal(payload.event, "service_readiness_not_ready");
  assert.equal(payload.metrics.broken_deeplink_rate, 0.1);
  assert.equal(payload.metrics.max_broken_deeplink_rate, 0.05);
  assert.equal(payload.metrics.broken_deeplink_count, 2);
  assert.equal(payload.metrics.deeplink_sample_size, 20);
  assert.equal(payload.metrics.collector_success_rate_7d, Number((19 / 21).toFixed(4)));
  assert.equal(payload.metrics.min_collector_success_rate_7d, 0.95);
  assert.equal(payload.metrics.collector_jobs_7d, 21);
  assert.doesNotMatch(serialized, /localhost/);
  assert.doesNotMatch(serialized, /koreanair\.com/);
});

test("service readiness fails booking conversion when an active source lacks enough deeplink samples", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    deepLinkAudit: {
      sample_size: 13,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
      valid_count_by_source: {
        skyscanner_affiliate: 5,
        korean_air_official: 4,
        asiana_official: 4,
      },
    },
  }));
  const bookingAxis = snapshot.axes.find((axis) => axis.id === "booking_conversion");
  const sampleDepthCheck = bookingAxis.checks.find((item) => item.name === "booking_deeplink_sample_depth");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(bookingAxis.status, "fail");
  assert.equal(sampleDepthCheck.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("booking_deeplink_sample_depth"));
  assert.deepEqual(sampleDepthCheck.detail.short_source_ids.map((item) => item.source_id), [
    "asiana_official",
    "korean_air_official",
  ]);
});

test("service readiness fails booking conversion when an active source has no deeplink sample", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    deepLinkAudit: {
      sample_size: 20,
      invalid_count: 0,
      distinct_hosts: ["www.skyscanner.com", "www.koreanair.com"],
      source_ids_with_links: ["skyscanner_affiliate", "korean_air_official"],
    },
  }));
  const bookingAxis = snapshot.axes.find((axis) => axis.id === "booking_conversion");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(bookingAxis.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("booking_deeplink_source_coverage"));
});

test("service readiness fails data supply when the batch is stale", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...readyInput().env,
      SOURCE_MAX_STALE_HOURS: "24",
    },
    batchState: {
      status: "success",
      last_batch_at: "2026-05-27T02:30:00Z",
    },
  }));

  assert.equal(snapshot.status, "not_ready");
  assert.ok(snapshot.summary.failed_checks.includes("fresh_successful_batch"));
});

test("service readiness fails launch operations when required gate artifacts are missing", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    launchArtifacts: {
      ...readyInput().launchArtifacts,
      opsAlertGate: false,
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(launchAxis.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("ops_alert_gate_available"));
});

test("service readiness requires a production build gate", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    launchArtifacts: {
      ...readyInput().launchArtifacts,
      productionBuildGate: false,
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");
  const check = launchAxis.checks.find((item) => item.name === "production_build_gate_available");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(launchAxis.status, "fail");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail, {
    command: "npm run build",
    workflow: ".github/workflows/collect-fares.yml",
  });
  assert.ok(snapshot.summary.failed_checks.includes("production_build_gate_available"));
});

test("service readiness requires contract test gates", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    launchArtifacts: {
      ...readyInput().launchArtifacts,
      contractTestGate: false,
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");
  const check = launchAxis.checks.find((item) => item.name === "contract_test_gate_available");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(launchAxis.status, "fail");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail, {
    commands: ["npm test", "python3 -m unittest discover -s tests"],
    workflow: ".github/workflows/collect-fares.yml",
  });
  assert.ok(snapshot.summary.failed_checks.includes("contract_test_gate_available"));
});

test("service readiness exposes every source policy kill switch", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput());
  const check = snapshot.axes
    .find((axis) => axis.id === "launch_operations")
    .checks.find((item) => item.name === "kill_switch_available");

  assert.equal(check.status, "pass");
  assert.deepEqual(check.detail.env_flags, [
    "SOURCE_SKYSCANNER_ENABLED",
    "SOURCE_KOREAN_AIR_ENABLED",
    "SOURCE_ASIANA_ENABLED",
    "SOURCE_GOOGLE_FLIGHTS_ENABLED",
    "SOURCE_KAYAK_ENABLED",
    "SOURCE_PROMO_PAGES_ENABLED",
    "SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED",
  ]);
});

test("service readiness requires explicit source kill switches and stale window", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    env: {
      ...readyInput().env,
      SOURCE_MAX_STALE_HOURS: "zero",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "maybe",
      SOURCE_ASIANA_ENABLED: "",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");
  const killSwitchCheck = launchAxis.checks.find((item) => item.name === "source_kill_switches_configured");
  const staleWindowCheck = launchAxis.checks.find((item) => item.name === "source_max_stale_hours_configured");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(killSwitchCheck.status, "fail");
  assert.equal(staleWindowCheck.status, "fail");
  assert.deepEqual(killSwitchCheck.detail.invalid, [
    { source_id: "korean_air_official", env_name: "SOURCE_KOREAN_AIR_ENABLED", reason: "invalid_boolean" },
    { source_id: "asiana_official", env_name: "SOURCE_ASIANA_ENABLED", reason: "missing" },
  ]);
  assert.equal(staleWindowCheck.detail.reason, "invalid_positive_integer");
  assert.ok(snapshot.summary.failed_checks.includes("source_kill_switches_configured"));
  assert.ok(snapshot.summary.failed_checks.includes("source_max_stale_hours_configured"));
});

test("service readiness fails launch operations when collector artifacts are not retained", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    launchArtifacts: {
      ...readyInput().launchArtifacts,
      collectorArtifactUpload: false,
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(launchAxis.status, "fail");
  assert.ok(snapshot.summary.failed_checks.includes("collector_artifact_upload_configured"));
});

test("service readiness requires strict collector artifact upload evidence", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput());
  const check = snapshot.axes
    .find((axis) => axis.id === "launch_operations")
    .checks.find((item) => item.name === "collector_artifact_upload_configured");

  assert.equal(check.status, "pass");
  assert.deepEqual(check.detail, {
    path: "runtime/collector-artifacts",
    artifact: "collector-artifacts",
    if_no_files_found: "error",
    retention_days: 30,
  });
});

test("service readiness requires retained service launch audit evidence", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput());
  const check = snapshot.axes
    .find((axis) => axis.id === "launch_operations")
    .checks.find((item) => item.name === "service_launch_audit_available");

  assert.equal(check.status, "pass");
  assert.equal(check.detail.output_dir, "runtime/service-launch-audits");
  assert.equal(check.detail.evidence_checklist, true);
  assert.equal(check.detail.retention_days, 90);
  assert.deepEqual(check.detail.required_evidence, [
    "release_gate",
    "alert_delivery",
    "collector_cutover",
    "collector_history_7d",
    "deeplink_samples",
    "persisted_launch_report",
  ]);
});

test("service readiness fails launch operations when public API 503 guard is missing", () => {
  const snapshot = buildServiceReadinessSnapshot(readyInput({
    launchArtifacts: {
      ...readyInput().launchArtifacts,
      publicApiFallbackGuard: false,
    },
  }));
  const launchAxis = snapshot.axes.find((axis) => axis.id === "launch_operations");
  const check = launchAxis.checks.find((item) => item.name === "public_api_503_guard_available");

  assert.equal(snapshot.status, "not_ready");
  assert.equal(launchAxis.status, "fail");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.detail.routes, ["/api/search", "/api/deals/map", "/api/deals/calendar", "/api/offers"]);
  assert.ok(snapshot.summary.failed_checks.includes("public_api_503_guard_available"));
});
