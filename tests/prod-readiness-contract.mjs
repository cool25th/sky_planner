import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  auditCollectorManifest,
  auditDatabaseReadiness,
  auditDbRoleSeparation,
  buildManifestLoadFailureReadinessOutput,
  deepLinkAuditChecks,
  sampleBookingDeepLinks,
  summarizeReadiness,
  validateBookingDeepLink,
  validateEndpointUrl,
} from "../scripts/prod-readiness-smoke.mjs";

function manifestWith(overrides = {}) {
  return {
    schema_version: "collector.source_manifest.v1",
    artifact_root: "runtime/collector-artifacts",
    revalidate: {
      url: "https://sky-planner.example-prod.com/api/revalidate",
      secret_env: "VERCEL_REVALIDATE_SECRET",
      timeout_ms: 10000,
    },
    sources: [
      {
        enabled: true,
        config: {
          schema_version: "collector.authorized_feed_source.v1",
          source_id: "skyscanner_affiliate",
          source_type: "meta_search",
          endpoint: "https://partners.skyscanner.net/fares",
          auth: {
            header_name: "Authorization",
            token_env: "SKYSCANNER_FEED_API_KEY",
            value_prefix: "Bearer ",
          },
          ...overrides,
        },
      },
    ],
  };
}

test("production readiness manifest audit fails placeholder secrets", () => {
  const audit = auditCollectorManifest(manifestWith(), {
    env: {
      SKYSCANNER_FEED_API_KEY: "test-token",
      VERCEL_REVALIDATE_SECRET: "test-secret",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("source_auth_secret_present"));
  assert.ok(summary.failed_checks.includes("revalidation_secret_present"));
});

test("production readiness manifest audit fails too-short secrets", () => {
  const audit = auditCollectorManifest(manifestWith(), {
    env: {
      SKYSCANNER_FEED_API_KEY: "short-secret",
      VERCEL_REVALIDATE_SECRET: "short-secret",
    },
  });
  const summary = summarizeReadiness([audit]);
  const authCheck = audit.checks.find((item) => item.name === "source_auth_secret_present");
  const revalidateCheck = audit.checks.find((item) => item.name === "revalidation_secret_present");

  assert.equal(summary.status, "not_ready");
  assert.equal(authCheck.status, "fail");
  assert.equal(authCheck.detail.reason, "too_short");
  assert.equal(revalidateCheck.status, "fail");
  assert.equal(revalidateCheck.detail.reason, "too_short");
});

test("production readiness manifest audit passes approved HTTPS sources with non-placeholder secrets", () => {
  const audit = auditCollectorManifest(manifestWith(), {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });

  assert.equal(summarizeReadiness([audit]).status, "ready");
  assert.deepEqual(audit.source_ids, ["skyscanner_affiliate"]);
  assert.equal(audit.checks.some((item) => item.status === "fail"), false);
  assert.equal(audit.checks.find((item) => item.name === "manifest_artifact_root_uploadable").status, "pass");
});

test("production readiness manifest audit requires workflow-uploaded collector artifact root", () => {
  const audit = auditCollectorManifest({
    ...manifestWith(),
    artifact_root: "tmp/collector-artifacts",
  }, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("manifest_artifact_root_uploadable"));
  assert.equal(audit.checks.find((item) => item.name === "manifest_artifact_root_uploadable").detail.expected_prefix, "runtime/collector-artifacts");
});

test("production readiness rejects inline placeholder revalidation secrets even when env secret exists", () => {
  const audit = auditCollectorManifest({
    ...manifestWith(),
    revalidate: {
      url: "https://sky-planner.example-prod.com/api/revalidate",
      secret: "replace-me",
      secret_env: "VERCEL_REVALIDATE_SECRET",
    },
  }, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("revalidation_secret_present"));
});

test("production readiness rejects revalidation secrets in query strings", () => {
  const audit = auditCollectorManifest({
    ...manifestWith(),
    revalidate: {
      url: "https://sky-planner.example-prod.com/api/revalidate?secret=leaky",
      secret_env: "VERCEL_REVALIDATE_SECRET",
    },
  }, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("revalidation_url_uses_header_secret"));
});

test("production readiness requires revalidation config", () => {
  const manifest = manifestWith();
  delete manifest.revalidate;
  const audit = auditCollectorManifest(manifest, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);
  const revalidationCheck = audit.checks.find((item) => item.name === "revalidation_configured");

  assert.equal(summary.status, "not_ready");
  assert.equal(revalidationCheck.status, "fail");
  assert.ok(summary.failed_checks.includes("revalidation_configured"));
});

test("production readiness rejects placeholder revalidation URLs", () => {
  const audit = auditCollectorManifest({
    ...manifestWith(),
    revalidate: {
      url: "https://your-app.vercel.app/api/revalidate",
      secret_env: "VERCEL_REVALIDATE_SECRET",
    },
  }, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);
  const revalidationShape = audit.checks.find((item) => item.name === "revalidation_url_production_shape");

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("revalidation_url_production_shape"));
  assert.equal(revalidationShape.detail.reason, "placeholder_host");
  assert.equal(revalidationShape.detail.host, "your-app.vercel.app");
});

test("production manifest template remains non-deployable", () => {
  const templateManifest = JSON.parse(
    readFileSync(new URL("../configs/collector-source-manifest.production.example.json", import.meta.url), "utf8"),
  );
  const audit = auditCollectorManifest(templateManifest, {
    env: {
      SKYSCANNER_FEED_API_KEY: "skyscanner-prod-secret-123",
      KOREAN_AIR_FEED_API_KEY: "korean-air-prod-secret-123",
      ASIANA_FEED_API_KEY: "asiana-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("source_endpoint_not_placeholder"));
  assert.ok(summary.failed_checks.includes("revalidation_url_production_shape"));
});

test("production readiness manifest audit fails missing source credentials", () => {
  const audit = auditCollectorManifest(manifestWith(), {
    env: {
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("source_auth_secret_present"));
});

test("production readiness manifest audit fails non-promo sources without auth", () => {
  const config = { ...manifestWith().sources[0].config };
  delete config.auth;
  const audit = auditCollectorManifest({
    ...manifestWith(),
    sources: [{ config }],
  }, {
    env: {
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);
  const authCheck = audit.checks.find((item) => item.name === "source_auth_secret_present");

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("source_auth_secret_present"));
  assert.equal(authCheck.status, "fail");
  assert.equal(authCheck.detail.reason, "non-promo source has no auth block");
});

test("production readiness allows promo page sources without auth", () => {
  const config = {
    ...manifestWith().sources[0].config,
    source_type: "promo_page",
  };
  delete config.auth;
  const audit = auditCollectorManifest({
    ...manifestWith(),
    sources: [{ config }],
  }, {
    env: {
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const authCheck = audit.checks.find((item) => item.name === "source_auth_secret_present");

  assert.equal(authCheck.status, "pass");
  assert.equal(authCheck.detail.reason, "promo_page");
});

test("production readiness recognizes official promo page source policy", () => {
  const config = {
    ...manifestWith().sources[0].config,
    source_id: "official_promo_pages",
    source_type: "promo_page",
    endpoint: "https://promos.example-prod.co.kr/fares",
  };
  delete config.auth;
  const audit = auditCollectorManifest({
    ...manifestWith(),
    sources: [{ config }],
  }, {
    env: {
      SOURCE_PROMO_PAGES_ENABLED: "true",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);
  const policyCheck = audit.checks.find((item) => item.name === "source_in_policy_catalog");
  const authCheck = audit.checks.find((item) => item.name === "source_auth_secret_present");

  assert.equal(summary.status, "ready");
  assert.equal(policyCheck.status, "pass");
  assert.equal(authCheck.status, "pass");
});

test("production readiness manifest audit fails env-disabled configured sources", () => {
  const audit = auditCollectorManifest(manifestWith({
    source_id: "korean_air_official",
    endpoint: "https://api.koreanair.example-prod.com/fares",
    auth: {
      header_name: "X-Api-Key",
      token_env: "KOREAN_AIR_FEED_API_KEY",
    },
  }), {
    env: {
      SOURCE_KOREAN_AIR_ENABLED: "false",
      KOREAN_AIR_FEED_API_KEY: "korean-air-prod-secret-123",
      VERCEL_REVALIDATE_SECRET: "vercel-revalidate-prod-secret-123",
    },
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("source_enabled_by_env"));
});

test("production readiness blocks local and placeholder feed endpoints by default", () => {
  assert.equal(validateEndpointUrl("http://localhost:9901/fares").status, "fail");
  assert.equal(validateEndpointUrl("https://example.test/fares").status, "fail");
  assert.equal(validateEndpointUrl("https://partners.example-prod.com/fares").status, "pass");
});

test("production readiness can allow local endpoints only for explicit non-prod checks", () => {
  assert.equal(
    validateEndpointUrl("http://localhost:9901/fares", {
      allowLocalEndpoints: true,
      allowInsecureEndpoints: true,
    }).status,
    "pass",
  );
});

test("production readiness blocks non-production booking deeplinks by default", () => {
  assert.equal(validateBookingDeepLink("https://www.koreanair.com/booking/search?from=ICN&to=NRT").status, "pass");
  assert.equal(validateBookingDeepLink("http://www.koreanair.com/booking/search").status, "fail");
  assert.equal(validateBookingDeepLink("http://localhost:3000/booking").status, "fail");
  assert.equal(validateBookingDeepLink("https://example.test/booking").status, "fail");
  assert.equal(validateBookingDeepLink("not-a-url").status, "fail");
});

test("production readiness can allow local deeplinks only for explicit non-prod checks", () => {
  assert.equal(
    validateBookingDeepLink("http://localhost:3000/booking", {
      allowLocalDeeplinks: true,
      allowInsecureDeeplinks: true,
    }).status,
    "pass",
  );
});

test("production readiness reports missing database URL instead of using a local default", async () => {
  const audit = await auditDatabaseReadiness({
    connectionString: "",
    sourceIds: ["skyscanner_affiliate"],
  });
  const summary = summarizeReadiness([audit]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("postgres_database_url_configured"));
  assert.ok(summary.failed_checks.includes("booking_deeplink_sample_depth"));
  assert.equal(audit.checks.find((item) => item.name === "postgres_database_url_configured").detail.reason, "database_url_missing");
  assert.deepEqual(audit.checks.find((item) => item.name === "booking_deeplink_sample_depth").detail.short_source_ids, [{
    source_id: "skyscanner_affiliate",
    valid_count: 0,
    minimum: 5,
  }]);
  assert.equal(audit.readiness.status, "not_ready");
});

test("production readiness requires deeplink samples for every manifest source", () => {
  const checks = deepLinkAuditChecks([
    {
      offer_id: "offer_1",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt",
    },
  ], ["korean_air_official", "skyscanner_affiliate"], {});
  const coverage = checks.find((item) => item.name === "booking_deeplink_source_coverage");
  const summary = summarizeReadiness([{ checks }]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("booking_deeplink_source_coverage"));
  assert.equal(coverage.status, "fail");
  assert.deepEqual(coverage.detail.source_ids_with_links, ["skyscanner_affiliate"]);
  assert.deepEqual(coverage.detail.missing_source_ids, ["korean_air_official"]);
});

test("production readiness requires canonical unique deeplink sample depth per source", () => {
  const checks = deepLinkAuditChecks([
    {
      offer_id: "offer_1",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt?sample=0",
    },
    {
      offer_id: "offer_2",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt?sample=0&utm_source=ops",
    },
    {
      offer_id: "offer_3",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt?sample=1&gclid=tracking-id",
    },
    {
      offer_id: "offer_4",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt?sample=1",
    },
    {
      offer_id: "offer_5",
      booking_source: "skyscanner",
      deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt?sample=2",
    },
  ], ["skyscanner_affiliate"], {});
  const depth = checks.find((item) => item.name === "booking_deeplink_sample_depth");
  const summary = summarizeReadiness([{ checks }]);

  assert.equal(summary.status, "not_ready");
  assert.ok(summary.failed_checks.includes("booking_deeplink_sample_depth"));
  assert.equal(depth.status, "fail");
  assert.equal(depth.detail.valid_count_by_source.skyscanner_affiliate, 3);
  assert.deepEqual(depth.detail.short_source_ids, [{
    source_id: "skyscanner_affiliate",
    valid_count: 3,
    minimum: 5,
  }]);
});

test("production readiness samples deeplinks independently for each manifest source", async () => {
  const calls = [];
  const client = {
    async query(_sql, params) {
      const sourceKeys = params[0];
      calls.push(sourceKeys);
      if (sourceKeys.includes("skyscanner_affiliate")) {
        return { rows: [{ booking_source: "skyscanner_affiliate", deep_link: "https://www.skyscanner.com/transport/flights/icn/nrt" }] };
      }
      if (sourceKeys.includes("ke")) {
        return { rows: [{ booking_source: "korean_air_official", deep_link: "https://www.koreanair.com/booking/search" }] };
      }
      return { rows: [] };
    },
  };
  const rows = await sampleBookingDeepLinks(client, ["skyscanner_affiliate", "korean_air_official"], 20);

  assert.equal(calls.length, 2);
  assert.ok(calls.some((sourceKeys) => sourceKeys.includes("skyscanner")));
  assert.ok(calls.some((sourceKeys) => sourceKeys.includes("ke")));
  assert.deepEqual(rows.map((row) => row.booking_source).sort(), ["korean_air_official", "skyscanner_affiliate"]);
});

test("production readiness ignores invalid deeplinks for source coverage", () => {
  const checks = deepLinkAuditChecks([
    {
      offer_id: "offer_1",
      booking_source: "skyscanner",
      deep_link: "http://localhost:3000/booking",
    },
  ], ["skyscanner_affiliate"], {});
  const coverage = checks.find((item) => item.name === "booking_deeplink_source_coverage");
  const shape = checks.find((item) => item.name === "booking_deeplink_production_shape");

  assert.equal(shape.status, "fail");
  assert.equal(shape.detail.reason, "broken_deeplink_rate_above_threshold");
  assert.equal(shape.detail.invalid_count, 1);
  assert.equal(shape.detail.invalid_rate, 1);
  assert.equal(shape.detail.max_invalid_rate, 0.05);
  assert.equal(coverage.status, "fail");
  assert.deepEqual(coverage.detail.source_ids_with_links, []);
  assert.deepEqual(coverage.detail.missing_source_ids, ["skyscanner_affiliate"]);
});

test("production readiness reports manifest load failures as structured JSON", () => {
  const output = buildManifestLoadFailureReadinessOutput({
    manifestEnv: "PROD_SOURCE_MANIFEST_JSON",
    error: new Error("Missing required collector source manifest env PROD_SOURCE_MANIFEST_JSON"),
    generatedAt: "2026-05-30T00:00:00.000Z",
  });
  const manifestCheck = output.checks.manifest.find((item) => item.name === "collector_manifest_configured");

  assert.equal(output.status, "not_ready");
  assert.equal(output.generated_at, "2026-05-30T00:00:00.000Z");
  assert.ok(output.summary.failed_checks.includes("collector_manifest_configured"));
  assert.equal(manifestCheck.status, "fail");
  assert.equal(manifestCheck.detail.manifest_env, "PROD_SOURCE_MANIFEST_JSON");
  assert.equal(manifestCheck.detail.reason, "missing");
  assert.deepEqual(output.manifest.source_ids, []);
});

function fakeRoleClient({ probeOutcome }) {
  return {
    queries: [],
    async query(sql) {
      this.queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("_role_separation_probe")) {
        if (probeOutcome === "allowed") return { rows: [] };
        throw new Error("permission denied for table");
      }
      return { rows: [] };
    },
    async end() {},
  };
}

function roleSeparationEnv() {
  return {
    DATABASE_READ_URL: "postgresql://sky_planner_read:password123456@db.example.com/sky_planner",
    DATABASE_INGEST_URL: "postgresql://sky_planner_ingest:password123456@db.example.com/sky_planner",
    DATABASE_MIGRATION_URL: "postgresql://sky_planner_migration:password123456@db.example.com/sky_planner",
  };
}

test("db role separation audit passes when least privilege is enforced", async () => {
  const clients = {
    read: fakeRoleClient({ probeOutcome: "denied" }),
    ingest: fakeRoleClient({ probeOutcome: "denied" }),
    migration: fakeRoleClient({ probeOutcome: "allowed" }),
  };
  const connect = async (url) => {
    if (url.includes("sky_planner_read")) return clients.read;
    if (url.includes("sky_planner_ingest")) return clients.ingest;
    if (url.includes("sky_planner_migration")) return clients.migration;
    throw new Error("unexpected url");
  };

  const audit = await auditDbRoleSeparation({ env: roleSeparationEnv(), connect });

  assert.equal(summarizeReadiness([audit]).status, "ready");
  assert.deepEqual(audit.checks.map((item) => item.name), [
    "db_role_urls_separated",
    "db_role_users_distinct",
    "db_read_role_write_denied",
    "db_ingest_role_ddl_denied",
    "db_migration_role_ddl_allowed",
  ]);
  assert.ok(audit.checks.every((item) => item.status === "pass"));
  assert.ok(clients.read.queries.includes("ROLLBACK"));
});

test("db role separation audit fails when role URLs are missing", async () => {
  const audit = await auditDbRoleSeparation({ env: {}, connect: async () => fakeRoleClient({ probeOutcome: "denied" }) });

  assert.equal(summarizeReadiness([audit]).status, "not_ready");
  assert.deepEqual(
    audit.checks.map((item) => item.name),
    ["db_role_urls_separated", "db_role_users_distinct"],
  );
  const urlCheck = audit.checks[0];
  assert.equal(urlCheck.status, "fail");
  assert.deepEqual(urlCheck.detail.missing.sort(), ["ingest_url_missing", "migration_url_missing", "read_url_missing"]);
});

test("db role separation audit fails when read role can write or ingest role can run DDL", async () => {
  const connect = async (url) => {
    if (url.includes("sky_planner_read")) return fakeRoleClient({ probeOutcome: "allowed" });
    if (url.includes("sky_planner_ingest")) return fakeRoleClient({ probeOutcome: "allowed" });
    return fakeRoleClient({ probeOutcome: "allowed" });
  };

  const audit = await auditDbRoleSeparation({ env: roleSeparationEnv(), connect });

  assert.equal(summarizeReadiness([audit]).status, "not_ready");
  assert.ok(audit.checks.find((item) => item.name === "db_read_role_write_denied").status === "fail");
  assert.ok(audit.checks.find((item) => item.name === "db_ingest_role_ddl_denied").status === "fail");
});

test("db role separation audit fails when a role database is unreachable", async () => {
  const connect = async (url) => {
    if (url.includes("sky_planner_read")) throw new Error("connection refused");
    return fakeRoleClient({ probeOutcome: "denied" });
  };

  const audit = await auditDbRoleSeparation({ env: roleSeparationEnv(), connect });

  assert.equal(summarizeReadiness([audit]).status, "not_ready");
  const readCheck = audit.checks.find((item) => item.name === "db_read_role_write_denied");
  assert.equal(readCheck.status, "fail");
  assert.equal(readCheck.detail.outcome, "unavailable");
});
