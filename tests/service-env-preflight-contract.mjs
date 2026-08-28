import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildServiceEnvPreflight,
  buildServiceEnvPreflightManifestLoadFailure,
  buildServiceRuntimeEnvPreflight,
  loadManifestForPreflight,
} from "../scripts/service-env-preflight.mjs";

function manifest(overrides = {}) {
  return {
    schema_version: "collector.source_manifest.v1",
    artifact_root: "runtime/collector-artifacts",
    revalidate: {
      url: "https://skyplanner.example-prod.com/api/revalidate",
      secret_env: "VERCEL_REVALIDATE_SECRET",
    },
    sources: [
      {
        config: {
          schema_version: "collector.authorized_feed_source.v1",
          source_id: "skyscanner_affiliate",
          source_type: "meta_search",
          parser_version: "authorized-json-feed-v1",
          endpoint: "https://feeds.skyscanner.example-prod.com/fares",
          method: "GET",
          auth: { header_name: "x-api-key", token_env: "SKYSCANNER_FEED_API_KEY" },
        },
      },
      {
        config: {
          schema_version: "collector.authorized_feed_source.v1",
          source_id: "korean_air_official",
          source_type: "airline_official",
          parser_version: "authorized-json-feed-v1",
          endpoint: "https://feeds.koreanair.example-prod.com/fares",
          method: "GET",
          auth: { header_name: "x-api-key", token_env: "KOREAN_AIR_FEED_API_KEY" },
        },
      },
      {
        config: {
          schema_version: "collector.authorized_feed_source.v1",
          source_id: "asiana_official",
          source_type: "airline_official",
          parser_version: "authorized-json-feed-v1",
          endpoint: "https://feeds.flyasiana.example-prod.com/fares",
          method: "GET",
          auth: { header_name: "x-api-key", token_env: "ASIANA_FEED_API_KEY" },
        },
      },
    ],
    ...overrides,
  };
}

function env(overrides = {}) {
  return {
    DATABASE_URL: "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
    OPS_ALERT_WEBHOOK_URL: "https://hooks.skyplanner.co.kr/service-readiness",
    OPS_READINESS_TOKEN: "ops-readiness-secret-123",
    SERVICE_REQUIRE_POSTGRES: "true",
    SUPPORT_EMAIL: "support@skyplanner.co.kr",
    VERCEL_REVALIDATE_SECRET: "vercel-secret-123",
    SKYSCANNER_FEED_API_KEY: "skyscanner-secret-123",
    KOREAN_AIR_FEED_API_KEY: "korean-air-secret-123",
    ASIANA_FEED_API_KEY: "asiana-secret-123",
    SOURCE_MAX_STALE_HOURS: "24",
    SOURCE_SKYSCANNER_ENABLED: "true",
    SOURCE_KOREAN_AIR_ENABLED: "true",
    SOURCE_ASIANA_ENABLED: "true",
    SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
    SOURCE_KAYAK_ENABLED: "false",
    SOURCE_PROMO_PAGES_ENABLED: "false",
    SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
    ...overrides,
  };
}

test("service environment preflight passes for production-shaped service settings", () => {
  const output = buildServiceEnvPreflight({
    env: env(),
    manifest: manifest(),
  });

  assert.equal(output.status, "pass");
  assert.equal(output.summary.failed, 0);
  assert.deepEqual(output.enabled_source_ids, ["skyscanner_affiliate", "korean_air_official", "asiana_official"]);
});

test("runtime environment preflight passes without collector manifest secrets", () => {
  const output = buildServiceRuntimeEnvPreflight({
    env: {
      DATABASE_URL: "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.skyplanner.co.kr/service-readiness",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SUPPORT_EMAIL: "support@skyplanner.co.kr",
      VERCEL_REVALIDATE_SECRET: "vercel-secret-123",
      SOURCE_MAX_STALE_HOURS: "24",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "true",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "false",
      SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
    },
  });

  assert.equal(output.status, "pass");
  assert.equal(output.summary.failed, 0);
});

test("runtime environment preflight fails unsafe runtime settings", () => {
  const output = buildServiceRuntimeEnvPreflight({
    env: {
      DATABASE_URL: "postgresql://sky_planner:secret@localhost:5432/sky_planner",
      OPS_ALERT_WEBHOOK_URL: "http://localhost:3000/alerts",
      OPS_READINESS_TOKEN: "test",
      SERVICE_REQUIRE_POSTGRES: "false",
      NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com",
      VERCEL_REVALIDATE_SECRET: "replace-me",
      SOURCE_MAX_STALE_HOURS: "zero",
      SOURCE_SKYSCANNER_ENABLED: "maybe",
    },
  });

  assert.equal(output.status, "fail");
  assert.ok(output.summary.failed_checks.includes("database_url_production_shape"));
  assert.ok(output.summary.failed_checks.includes("ops_alert_webhook_url_configured"));
  assert.ok(output.summary.failed_checks.includes("support_contact_configured"));
  assert.ok(output.summary.failed_checks.includes("ops_readiness_token_configured"));
  assert.ok(output.summary.failed_checks.includes("mock_fallback_disabled"));
  assert.ok(output.summary.failed_checks.includes("secret_value_present"));
  assert.ok(output.summary.failed_checks.includes("source_kill_switches_configured"));
  assert.ok(output.summary.failed_checks.includes("source_max_stale_hours_configured"));
});

test("runtime environment preflight requires explicit source kill switches", () => {
  const output = buildServiceRuntimeEnvPreflight({
    env: {
      DATABASE_URL: "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.skyplanner.co.kr/service-readiness",
      OPS_READINESS_TOKEN: "ops-readiness-secret-123",
      SERVICE_REQUIRE_POSTGRES: "true",
      SUPPORT_EMAIL: "support@skyplanner.co.kr",
      VERCEL_REVALIDATE_SECRET: "vercel-secret-123",
      SOURCE_MAX_STALE_HOURS: "24",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "true",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "disabled",
      SOURCE_KAYAK_ENABLED: "no",
    },
  });
  const killSwitchCheck = output.checks.find((item) => item.name === "source_kill_switches_configured");

  assert.equal(output.status, "fail");
  assert.equal(killSwitchCheck.status, "fail");
  assert.deepEqual(killSwitchCheck.detail.invalid, [
    { source_id: "official_promo_pages", env_name: "SOURCE_PROMO_PAGES_ENABLED", reason: "missing" },
    { source_id: "travelpayouts_aviasales", env_name: "SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED", reason: "missing" },
  ]);
});

test("service environment preflight fails local and placeholder service settings", () => {
  const output = buildServiceEnvPreflight({
    env: env({
      DATABASE_URL: "postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.example.com/services/replace-me",
      SUPPORT_EMAIL: "support@example.com",
      SKYSCANNER_FEED_API_KEY: "replace-me",
    }),
    manifest: manifest({
      revalidate: {
        url: "https://your-app.vercel.app/api/revalidate",
        secret_env: "VERCEL_REVALIDATE_SECRET",
      },
      sources: [
        {
          config: {
            schema_version: "collector.authorized_feed_source.v1",
            source_id: "skyscanner_affiliate",
            source_type: "meta_search",
            parser_version: "authorized-json-feed-v1",
            endpoint: "https://feeds.example.com/fares",
            method: "GET",
            auth: { header_name: "x-api-key", token_env: "SKYSCANNER_FEED_API_KEY" },
          },
        },
      ],
    }),
  });

  assert.equal(output.status, "fail");
  assert.ok(output.summary.failed_checks.includes("database_url_production_shape"));
  assert.ok(output.summary.failed_checks.includes("ops_alert_webhook_url_configured"));
  assert.ok(output.summary.failed_checks.includes("support_contact_configured"));
  assert.ok(output.summary.failed_checks.includes("secret_value_present"));
  assert.ok(output.summary.failed_checks.includes("source_endpoint_not_placeholder"));
  assert.ok(output.summary.failed_checks.includes("revalidation_url_production_shape"));
});

test("service environment preflight fails too-short production secrets", () => {
  const output = buildServiceEnvPreflight({
    env: env({
      SKYSCANNER_FEED_API_KEY: "short-secret",
      VERCEL_REVALIDATE_SECRET: "short-secret",
    }),
    manifest: manifest({
      sources: [manifest().sources[0]],
    }),
  });
  const sourceSecretCheck = output.checks.find((item) => item.name === "source_auth_secret_present");
  const revalidationCheck = output.checks.find((item) => item.name === "revalidation_secret_present");
  const genericSecretChecks = output.checks.filter((item) => item.name === "secret_value_present");

  assert.equal(output.status, "fail");
  assert.ok(output.summary.failed_checks.includes("secret_value_present"));
  assert.equal(sourceSecretCheck.status, "fail");
  assert.equal(sourceSecretCheck.detail.reason, "too_short");
  assert.equal(revalidationCheck.status, "fail");
  assert.equal(revalidationCheck.detail.reason, "too_short");
  assert.ok(genericSecretChecks.some((item) => item.detail.env_name === "SKYSCANNER_FEED_API_KEY" && item.detail.reason === "too_short"));
  assert.ok(genericSecretChecks.some((item) => item.detail.env_name === "VERCEL_REVALIDATE_SECRET" && item.detail.reason === "too_short"));
});

test("service environment preflight fails collector artifact roots outside uploaded runtime path", () => {
  const output = buildServiceEnvPreflight({
    env: env(),
    manifest: manifest({
      artifact_root: "tmp/collector-artifacts",
    }),
  });

  assert.equal(output.status, "fail");
  assert.ok(output.summary.failed_checks.includes("manifest_artifact_root_uploadable"));
});

test("service environment preflight reports manifest load failures as structured checks", () => {
  const output = buildServiceEnvPreflightManifestLoadFailure({
    env: env(),
    manifestEnv: "PROD_SOURCE_MANIFEST_JSON",
    error: new Error("Missing required collector source manifest env PROD_SOURCE_MANIFEST_JSON"),
  });
  const manifestCheck = output.checks.find((item) => item.name === "collector_manifest_configured");

  assert.equal(output.status, "fail");
  assert.deepEqual(output.enabled_source_ids, []);
  assert.ok(output.summary.failed_checks.includes("collector_manifest_configured"));
  assert.equal(manifestCheck.status, "fail");
  assert.equal(manifestCheck.detail.manifest_env, "PROD_SOURCE_MANIFEST_JSON");
  assert.equal(manifestCheck.detail.reason, "missing");
});

test("service environment preflight validates secrets from config_path manifests", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "sky-planner-service-env-"));
  try {
    const sourcePath = path.join(tempDir, "skyscanner-feed.json");
    await writeFile(sourcePath, JSON.stringify({
      schema_version: "collector.authorized_feed_source.v1",
      source_id: "skyscanner_affiliate",
      source_type: "meta_search",
      parser_version: "authorized-json-feed-v1",
      endpoint: "https://feeds.skyscanner.example-prod.com/fares",
      method: "GET",
      auth: { header_name: "x-api-key", token_env: "SKYSCANNER_FEED_API_KEY" },
    }));

    const manifestEnv = {
      COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify(manifest({
        sources: [{ config_path: "skyscanner-feed.json" }],
      })),
    };
    const loadedManifest = await loadManifestForPreflight({
      env: manifestEnv,
      baseDir: tempDir,
    });

    const missingSecret = buildServiceEnvPreflight({
      env: env({ SKYSCANNER_FEED_API_KEY: "" }),
      manifest: loadedManifest,
    });
    assert.equal(missingSecret.status, "fail");
    assert.ok(missingSecret.summary.failed_checks.includes("secret_value_present"));
    assert.ok(missingSecret.summary.failed_checks.includes("source_auth_secret_present"));

    const ready = buildServiceEnvPreflight({
      env: env(),
      manifest: loadedManifest,
    });
    assert.equal(ready.status, "pass");
    assert.deepEqual(ready.enabled_source_ids, ["skyscanner_affiliate"]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
