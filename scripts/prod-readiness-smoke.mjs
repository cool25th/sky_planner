import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  SOURCE_POLICY_CATALOG,
  enabledSourceFlagsFromEnv,
  sourceIdForBookingSourceKey,
  sourceMaxStaleHoursFromEnv,
} from "../lib/source-policy.ts";
import { secretValueFailure } from "../lib/secret-validation.ts";
import { buildSourceReadinessSnapshot } from "../lib/source-readiness.ts";
import {
  loadCollectorSourceManifest,
  loadCollectorSourceManifestFromEnv,
} from "./run-collector-sources.mjs";

const { Client } = pg;

const REQUIRED_TABLES = ["places", "offers", "deals_current", "source_health", "source_jobs", "batch_state"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const MIN_DEEPLINK_SAMPLES_PER_SOURCE = 5;
const MAX_BROKEN_DEEPLINK_RATE = 0.05;
const TRACKING_QUERY_PARAMS = new Set(["_ga", "_gl", "dclid", "fbclid", "gbraid", "gclid", "mc_cid", "mc_eid", "msclkid", "wbraid", "yclid"]);
const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "example.test",
  "your-app.vercel.app",
  "your-project.vercel.app",
]);
function check(name, status, detail = {}) {
  return { name, status, detail };
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

function parseArgs(argv) {
  const args = {
    manifest: "",
    manifestEnv: "",
    databaseUrl: process.env.DATABASE_URL || "",
    searchUrl: "",
    sourceHealthUrl: "",
    maxStaleHours: sourceMaxStaleHoursFromEnv(),
    deeplinkSampleSize: 20,
    allowLocalEndpoints: false,
    allowPlaceholderEndpoints: false,
    allowInsecureEndpoints: false,
    allowLocalDeeplinks: false,
    allowPlaceholderDeeplinks: false,
    allowInsecureDeeplinks: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      args.manifest = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--manifest-env") {
      args.manifestEnv = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--search-url") {
      args.searchUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--source-health-url") {
      args.sourceHealthUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--max-stale-hours") {
      args.maxStaleHours = Number(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--deeplink-sample-size") {
      args.deeplinkSampleSize = Number(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--allow-local-endpoints") {
      args.allowLocalEndpoints = true;
    } else if (arg === "--allow-placeholder-endpoints") {
      args.allowPlaceholderEndpoints = true;
    } else if (arg === "--allow-insecure-endpoints") {
      args.allowInsecureEndpoints = true;
    } else if (arg === "--allow-local-deeplinks") {
      args.allowLocalDeeplinks = true;
    } else if (arg === "--allow-placeholder-deeplinks") {
      args.allowPlaceholderDeeplinks = true;
    } else if (arg === "--allow-insecure-deeplinks") {
      args.allowInsecureDeeplinks = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (Boolean(args.manifest) === Boolean(args.manifestEnv)) {
    throw new Error("Provide exactly one of --manifest <path> or --manifest-env <env-name>");
  }
  if (!Number.isFinite(args.maxStaleHours) || args.maxStaleHours <= 0) {
    throw new Error("--max-stale-hours must be a positive number");
  }
  if (!Number.isInteger(args.deeplinkSampleSize) || args.deeplinkSampleSize <= 0) {
    throw new Error("--deeplink-sample-size must be a positive integer");
  }
  return args;
}

function sourceEnvFor(sourceIds, maxStaleHours) {
  const selected = new Set(sourceIds);
  return Object.fromEntries([
    ...SOURCE_POLICY_CATALOG.map((source) => [source.env_flag, selected.has(source.source_id) ? "true" : "false"]),
    ["SOURCE_MAX_STALE_HOURS", String(maxStaleHours)],
  ]);
}

function policyBySourceId() {
  return new Map(SOURCE_POLICY_CATALOG.map((source) => [source.source_id, source]));
}

function manifestEnabledSources(manifest) {
  return manifest.sources
    .filter((source) => source.enabled !== false)
    .map((source) => source.config);
}

function validateArtifactRoot(manifest) {
  const artifactRoot = String(manifest.artifact_root ?? "runtime/collector-artifacts").replace(/\\/g, "/");
  const valid =
    artifactRoot === "runtime/collector-artifacts" ||
    artifactRoot.startsWith("runtime/collector-artifacts/");
  return valid
    ? check("manifest_artifact_root_uploadable", "pass", { artifact_root: artifactRoot })
    : check("manifest_artifact_root_uploadable", "fail", {
        artifact_root: artifactRoot,
        expected_prefix: "runtime/collector-artifacts",
      });
}

export function validateEndpointUrl(endpoint, options = {}) {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && !options.allowInsecureEndpoints) {
    return check("source_endpoint_https", "fail", { endpoint, protocol: url.protocol });
  }
  if (LOCAL_HOSTS.has(host) && !options.allowLocalEndpoints) {
    return check("source_endpoint_not_local", "fail", { endpoint, host });
  }
  if (isPlaceholderHost(host) && !options.allowPlaceholderEndpoints) {
    return check("source_endpoint_not_placeholder", "fail", { endpoint, host });
  }
  return check("source_endpoint_production_shape", "pass", { endpoint: url.origin });
}

function urlFailureReason(rawUrl, options = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { reason: "invalid_url", url: rawUrl };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && !options.allowInsecure) {
    return { reason: "not_https", url: rawUrl, protocol: url.protocol };
  }
  if (LOCAL_HOSTS.has(host) && !options.allowLocal) {
    return { reason: "local_host", url: rawUrl, host };
  }
  if (isPlaceholderHost(host) && !options.allowPlaceholder) {
    return { reason: "placeholder_host", url: rawUrl, host };
  }
  return null;
}

export function validateBookingDeepLink(deepLink, options = {}) {
  const failure = urlFailureReason(deepLink, {
    allowInsecure: options.allowInsecureDeeplinks,
    allowLocal: options.allowLocalDeeplinks,
    allowPlaceholder: options.allowPlaceholderDeeplinks,
  });
  return failure
    ? check("booking_deeplink_production_shape", "fail", failure)
    : check("booking_deeplink_production_shape", "pass", { origin: new URL(deepLink).origin });
}

function validateRevalidationUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return [
      check("revalidation_url_production_shape", "fail", { reason: "invalid_url" }),
      check("revalidation_url_uses_header_secret", "fail", { reason: "invalid_url" }),
    ];
  }
  const host = url.hostname.toLowerCase();
  const productionShapeCheck = (() => {
    if (url.protocol !== "https:") {
      return check("revalidation_url_production_shape", "fail", {
        reason: "not_https",
        protocol: url.protocol,
        host,
      });
    }
    if (LOCAL_HOSTS.has(host)) {
      return check("revalidation_url_production_shape", "fail", { reason: "local_host", host });
    }
    if (isPlaceholderHost(host)) {
      return check("revalidation_url_production_shape", "fail", { reason: "placeholder_host", host });
    }
    return check("revalidation_url_production_shape", "pass", { origin: url.origin });
  })();
  const hasSecretQuery = [...url.searchParams.keys()].some((key) => /secret|token|key/i.test(key));
  const headerSecretCheck = hasSecretQuery
    ? check("revalidation_url_uses_header_secret", "fail", { reason: "secret_query_param" })
    : check("revalidation_url_uses_header_secret", "pass", { origin: url.origin });
  return [productionShapeCheck, headerSecretCheck];
}

export function auditCollectorManifest(manifest, options = {}) {
  const env = options.env ?? process.env;
  const maxStaleHours = options.maxStaleHours ?? sourceMaxStaleHoursFromEnv(env);
  const enabledSources = manifestEnabledSources(manifest);
  const enabledSourceIds = enabledSources.map((config) => config.source_id);
  const envEnabledSources = enabledSourceFlagsFromEnv(env);
  const envEnabledSet = new Set(envEnabledSources);
  const policyMap = policyBySourceId();
  const checks = [];

  checks.push(
    enabledSources.length > 0
      ? check("manifest_enabled_sources", "pass", { count: enabledSources.length, source_ids: enabledSourceIds })
      : check("manifest_enabled_sources", "fail", { count: 0 }),
  );

  const duplicateSourceIds = enabledSourceIds.filter((sourceId, index) => enabledSourceIds.indexOf(sourceId) !== index);
  checks.push(
    duplicateSourceIds.length === 0
      ? check("manifest_source_ids_unique", "pass")
      : check("manifest_source_ids_unique", "fail", { duplicate_source_ids: [...new Set(duplicateSourceIds)] }),
  );

  checks.push(validateArtifactRoot(manifest));

  for (const sourceConfig of enabledSources) {
    const policy = policyMap.get(sourceConfig.source_id);
    checks.push(
      policy
        ? check("source_in_policy_catalog", "pass", { source_id: sourceConfig.source_id })
        : check("source_in_policy_catalog", "fail", { source_id: sourceConfig.source_id }),
    );
    if (policy) {
      checks.push(
        envEnabledSet.has(sourceConfig.source_id)
          ? check("source_enabled_by_env", "pass", { source_id: sourceConfig.source_id, env_flag: policy.env_flag })
          : check("source_enabled_by_env", "fail", { source_id: sourceConfig.source_id, env_flag: policy.env_flag }),
      );
    }
    checks.push(validateEndpointUrl(sourceConfig.endpoint, options));
    if (sourceConfig.auth?.token_env) {
      const reason = secretValueFailure(env[sourceConfig.auth.token_env]);
      checks.push(
        reason
          ? check("source_auth_secret_present", "fail", { source_id: sourceConfig.source_id, token_env: sourceConfig.auth.token_env, reason })
          : check("source_auth_secret_present", "pass", { source_id: sourceConfig.source_id, token_env: sourceConfig.auth.token_env }),
      );
    } else if (sourceConfig.source_type === "promo_page") {
      checks.push(check("source_auth_secret_present", "pass", { source_id: sourceConfig.source_id, reason: "promo_page" }));
    } else {
      checks.push(check("source_auth_secret_present", "fail", {
        source_id: sourceConfig.source_id,
        reason: "non-promo source has no auth block",
      }));
    }
  }

  if (manifest.revalidate) {
    checks.push(...validateRevalidationUrl(manifest.revalidate.url));
    const secretEnv = manifest.revalidate.secret_env ?? "VERCEL_REVALIDATE_SECRET";
    const inlineSecretReason = manifest.revalidate.secret ? secretValueFailure(manifest.revalidate.secret) : "missing";
    const envSecretReason = secretValueFailure(env[secretEnv]);
    const reason = inlineSecretReason === "missing" ? envSecretReason ?? "missing" : inlineSecretReason;
    const hasValidSecret = inlineSecretReason === "missing" ? !envSecretReason : !inlineSecretReason;
    checks.push(
      hasValidSecret
        ? check("revalidation_secret_present", "pass", { secret_env: secretEnv })
        : check("revalidation_secret_present", "fail", {
          secret_env: secretEnv,
          reason,
        }),
    );
  } else {
    checks.push(check("revalidation_configured", "fail", { reason: "manifest has no revalidate block" }));
  }

  return {
    source_ids: enabledSourceIds,
    env_enabled_source_ids: envEnabledSources,
    max_stale_hours: maxStaleHours,
    checks,
  };
}

async function tableNames(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  return new Set(rows.map((row) => String(row.table_name)));
}

async function tableCount(client, tableName, whereSql = "") {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName} ${whereSql}`);
  return Number(rows[0]?.count ?? 0);
}

export async function sampleBookingDeepLinks(client, sourceIds, limit) {
  return (await Promise.all([...new Set(sourceIds)].sort().map(async (sourceId) => {
    const { rows } = await client.query(
      `
        SELECT offer_id, booking_source, airline_code, destination_city_id, deep_link
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
      [bookingSourceKeysForSource(sourceId), limit],
    );
    return rows;
  }))).flat();
}

export function deepLinkAuditChecks(rows, sourceIds, options) {
  if (!rows.length) {
    return [
      check("booking_deeplink_sample_present", "fail", {
        source_ids: sourceIds,
        sample_size: 0,
      }),
      check("booking_deeplink_source_coverage", "fail", {
        required_source_ids: sourceIds,
        source_ids_with_links: [],
        missing_source_ids: sourceIds,
      }),
      check("booking_deeplink_sample_depth", "fail", {
        reason: "no_deeplink_samples",
        minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        valid_count_by_source: {},
        short_source_ids: sourceIds.map((sourceId) => ({
          source_id: sourceId,
          valid_count: 0,
          minimum: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        })),
      }),
    ];
  }
  const failures = rows
    .map((row) => ({
      offer_id: row.offer_id,
      booking_source: row.booking_source,
      deep_link: row.deep_link,
      failure: urlFailureReason(row.deep_link, {
        allowInsecure: options.allowInsecureDeeplinks,
        allowLocal: options.allowLocalDeeplinks,
        allowPlaceholder: options.allowPlaceholderDeeplinks,
      }),
    }))
    .filter((row) => row.failure);
  const sourceIdsWithLinks = [...new Set(rows
    .filter((row) => !urlFailureReason(row.deep_link, {
      allowInsecure: options.allowInsecureDeeplinks,
      allowLocal: options.allowLocalDeeplinks,
      allowPlaceholder: options.allowPlaceholderDeeplinks,
    }))
    .map((row) => sourceIdForBookingSourceKey(row.booking_source))
    .filter(Boolean))].sort();
  const missingSourceIds = sourceIds.filter((sourceId) => !sourceIdsWithLinks.includes(sourceId));
  const validCountBySource = validDeepLinkCountsBySource(rows, options);
  const shortSourceIds = sourceIds
    .map((sourceId) => ({
      source_id: sourceId,
      valid_count: validCountBySource[sourceId] ?? 0,
      minimum: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
    }))
    .filter((source) => source.valid_count < MIN_DEEPLINK_SAMPLES_PER_SOURCE);
  const invalidRate = rows.length > 0 ? Number((failures.length / rows.length).toFixed(4)) : null;
  return [
    check("booking_deeplink_sample_present", "pass", {
      source_ids: sourceIds,
      sample_size: rows.length,
    }),
    failures.length === 0
      ? check("booking_deeplink_production_shape", "pass", {
        sample_size: rows.length,
        invalid_count: 0,
        invalid_rate: 0,
        max_invalid_rate: MAX_BROKEN_DEEPLINK_RATE,
        distinct_hosts: [...new Set(rows.map((row) => new URL(row.deep_link).hostname.toLowerCase()))].sort(),
      })
      : check("booking_deeplink_production_shape", "fail", {
        reason: invalidRate !== null && invalidRate > MAX_BROKEN_DEEPLINK_RATE
          ? "broken_deeplink_rate_above_threshold"
          : "invalid_deeplink_sample",
        failed_count: failures.length,
        sample_size: rows.length,
        invalid_count: failures.length,
        invalid_rate: invalidRate,
        max_invalid_rate: MAX_BROKEN_DEEPLINK_RATE,
        failures: failures.slice(0, 10),
      }),
    missingSourceIds.length === 0
      ? check("booking_deeplink_source_coverage", "pass", { source_ids_with_links: sourceIdsWithLinks })
      : check("booking_deeplink_source_coverage", "fail", {
        required_source_ids: sourceIds,
        source_ids_with_links: sourceIdsWithLinks,
        missing_source_ids: missingSourceIds,
      }),
    shortSourceIds.length === 0
      ? check("booking_deeplink_sample_depth", "pass", {
        minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        valid_count_by_source: validCountBySource,
      })
      : check("booking_deeplink_sample_depth", "fail", {
        reason: "insufficient_valid_deeplink_samples",
        minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
        valid_count_by_source: validCountBySource,
        short_source_ids: shortSourceIds,
      }),
  ];
}

function bookingSourceKeysForSource(sourceId) {
  const policy = SOURCE_POLICY_CATALOG.find((source) => source.source_id === sourceId);
  return [...new Set([sourceId, ...(policy?.booking_source_keys ?? [])]
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean))].sort();
}

function validDeepLinkCountsBySource(rows, options) {
  const urlsBySource = new Map();
  for (const row of rows) {
    if (urlFailureReason(row.deep_link, {
      allowInsecure: options.allowInsecureDeeplinks,
      allowLocal: options.allowLocalDeeplinks,
      allowPlaceholder: options.allowPlaceholderDeeplinks,
    })) continue;
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

function deepLinkHosts(rows) {
  return [...new Set(rows.flatMap((row) => {
    try {
      return [new URL(row.deep_link).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }))].sort();
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function batchFreshnessCheck(batchState, now, maxStaleHours) {
  const lastBatchAt = parseDate(batchState?.last_batch_at ?? batchState?.lastBatchAt);
  if (!lastBatchAt) {
    return check("last_batch_fresh", "fail", { reason: "missing_or_invalid_last_batch_at" });
  }
  const ageHours = (now.getTime() - lastBatchAt.getTime()) / 3600000;
  return ageHours <= maxStaleHours
    ? check("last_batch_fresh", "pass", { last_batch_at: lastBatchAt.toISOString(), age_hours: Number(ageHours.toFixed(2)) })
    : check("last_batch_fresh", "fail", {
      last_batch_at: lastBatchAt.toISOString(),
      age_hours: Number(ageHours.toFixed(2)),
      max_stale_hours: maxStaleHours,
    });
}

export async function auditDatabaseReadiness(options) {
  const now = options.now ?? new Date();
  const sourceIds = options.sourceIds ?? [];
  const maxStaleHours = options.maxStaleHours ?? sourceMaxStaleHoursFromEnv();
  const checks = [];
  const connectionString = options.connectionString ?? process.env.DATABASE_URL ?? "";
  if (!connectionString) {
    return {
      counts: null,
      deeplink_sample: { checked: 0, hosts: [] },
      readiness: {
        status: "not_ready",
        counts: {
          enabled_sources: sourceIds.length,
          search_eligible_sources: 0,
          blocked_sources: sourceIds.length,
          env_enabled_sources: sourceIds.length,
        },
        source_flags: sourceIds,
        blocked_source_ids: sourceIds,
      },
      checks: [
        check("postgres_database_url_configured", "fail", { reason: "database_url_missing" }),
        check("postgres_required_tables", "fail", { reason: "database_url_missing", tables: REQUIRED_TABLES }),
        check("places_seeded", "fail", { reason: "database_url_missing" }),
        check("active_offers_present", "fail", { reason: "database_url_missing" }),
        check("active_deals_present", "fail", { reason: "database_url_missing" }),
        check("last_batch_success", "fail", { reason: "database_url_missing" }),
        check("last_batch_fresh", "fail", { reason: "database_url_missing" }),
        check("manifest_sources_have_health", "fail", { reason: "database_url_missing", source_ids: sourceIds }),
        check("source_readiness_ready", "fail", { reason: "database_url_missing", blocked_source_ids: sourceIds }),
        check("manifest_sources_unblocked", "fail", { reason: "database_url_missing", blocked_source_ids: sourceIds }),
        check("last_batch_includes_manifest_sources", "fail", { reason: "database_url_missing", missing_source_ids: sourceIds }),
        check("booking_deeplink_sample_present", "fail", { reason: "database_url_missing", source_ids: sourceIds, sample_size: 0 }),
        check("booking_deeplink_source_coverage", "fail", { reason: "database_url_missing", required_source_ids: sourceIds, source_ids_with_links: [], missing_source_ids: sourceIds }),
        check("booking_deeplink_sample_depth", "fail", {
          reason: "database_url_missing",
          minimum_per_source: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
          valid_count_by_source: {},
          short_source_ids: sourceIds.map((sourceId) => ({
            source_id: sourceId,
            valid_count: 0,
            minimum: MIN_DEEPLINK_SAMPLES_PER_SOURCE,
          })),
        }),
        check("booking_deeplink_production_shape", "fail", {
          reason: "database_url_missing",
          sample_size: 0,
          invalid_count: 0,
          invalid_rate: null,
          max_invalid_rate: MAX_BROKEN_DEEPLINK_RATE,
        }),
      ],
    };
  }

  checks.push(check("postgres_database_url_configured", "pass"));
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tables = await tableNames(client);
    const missingTables = REQUIRED_TABLES.filter((tableName) => !tables.has(tableName));
    checks.push(
      missingTables.length === 0
        ? check("postgres_required_tables", "pass", { tables: REQUIRED_TABLES })
        : check("postgres_required_tables", "fail", { missing_tables: missingTables }),
    );

    const counts = {
      places: await tableCount(client, "places"),
      offers_active: await tableCount(client, "offers", "WHERE is_active = true"),
      deals_current_active: await tableCount(client, "deals_current", "WHERE is_active = true"),
      source_health: await tableCount(client, "source_health"),
    };
    checks.push(counts.places > 0 ? check("places_seeded", "pass", { count: counts.places }) : check("places_seeded", "fail", { count: counts.places }));
    checks.push(
      counts.offers_active > 0
        ? check("active_offers_present", "pass", { count: counts.offers_active })
        : check("active_offers_present", "fail", { count: counts.offers_active }),
    );
    checks.push(
      counts.deals_current_active > 0
        ? check("active_deals_present", "pass", { count: counts.deals_current_active })
        : check("active_deals_present", "fail", { count: counts.deals_current_active }),
    );

    const { rows: batchRows } = await client.query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1");
    const batchState = batchRows[0]?.data ?? null;
    checks.push(
      batchState?.status === "success"
        ? check("last_batch_success", "pass", {
          execution_id: batchState.execution_id ?? null,
          last_batch_at: batchState.last_batch_at ?? null,
        })
        : check("last_batch_success", "fail", { batch_state: batchState }),
    );
    checks.push(batchFreshnessCheck(batchState, now, maxStaleHours));

    const { rows: healthRows } = await client.query(
      `
        SELECT source_id, is_paused, enabled_by_flag, circuit_breaker_open, consecutive_failures, last_success_at
        FROM source_health
        WHERE source_id = ANY($1::text[])
      `,
      [sourceIds],
    );
    const healthSourceIds = new Set(healthRows.map((row) => String(row.source_id)));
    const missingHealth = sourceIds.filter((sourceId) => !healthSourceIds.has(sourceId));
    checks.push(
      missingHealth.length === 0
        ? check("manifest_sources_have_health", "pass", { source_ids: sourceIds })
        : check("manifest_sources_have_health", "fail", { missing_source_ids: missingHealth }),
    );

    const readiness = buildSourceReadinessSnapshot({
      healthRows,
      batchState,
      env: sourceEnvFor(sourceIds, maxStaleHours),
      now,
    });
    checks.push(
      readiness.status === "ready"
        ? check("source_readiness_ready", "pass", {
          status: readiness.status,
          counts: readiness.counts,
          source_flags: readiness.source_flags,
        })
        : check("source_readiness_ready", "fail", {
          status: readiness.status,
          counts: readiness.counts,
          blocked_source_ids: readiness.blocked_source_ids,
        }),
    );
    checks.push(
      readiness.blocked_source_ids.length === 0
        ? check("manifest_sources_unblocked", "pass")
        : check("manifest_sources_unblocked", "fail", { blocked_source_ids: readiness.blocked_source_ids }),
    );

    const lastBatchSources = new Set(batchState?.source_flags ?? batchState?.sourceFlags ?? []);
    const missingFromLastBatch = sourceIds.filter((sourceId) => !lastBatchSources.has(sourceId));
    checks.push(
      missingFromLastBatch.length === 0
        ? check("last_batch_includes_manifest_sources", "pass", { source_ids: sourceIds })
        : check("last_batch_includes_manifest_sources", "fail", { missing_source_ids: missingFromLastBatch }),
    );

    const deepLinkRows = await sampleBookingDeepLinks(client, sourceIds, options.deeplinkSampleSize ?? 20);
    checks.push(...deepLinkAuditChecks(deepLinkRows, sourceIds, options));

    return {
      counts,
      deeplink_sample: {
        checked: deepLinkRows.length,
        hosts: deepLinkHosts(deepLinkRows),
      },
      readiness: {
        status: readiness.status,
        counts: readiness.counts,
        source_flags: readiness.source_flags,
        blocked_source_ids: readiness.blocked_source_ids,
      },
      checks,
    };
  } finally {
    await client.end();
  }
}

async function defaultDbConnect(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function probeSqlInTransaction(connect, connectionString, statement) {
  let client;
  try {
    client = await connect(connectionString);
  } catch {
    return "unavailable";
  }
  try {
    await client.query("BEGIN");
    try {
      await client.query(statement);
      return "allowed";
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  } catch {
    return "denied";
  } finally {
    await client.end().catch(() => {});
  }
}

export async function auditDbRoleSeparation(options = {}) {
  const env = options.env ?? process.env;
  const connect = options.connect ?? defaultDbConnect;
  const urls = {
    read: env.DATABASE_READ_URL || "",
    ingest: env.DATABASE_INGEST_URL || "",
    migration: env.DATABASE_MIGRATION_URL || "",
  };
  const checks = [];

  const missingRoles = Object.entries(urls).filter(([, url]) => !url).map(([role]) => `${role}_url_missing`);
  checks.push(
    missingRoles.length === 0
      ? check("db_role_urls_separated", "pass", { roles: ["read", "ingest", "migration"] })
      : check("db_role_urls_separated", "fail", { missing: missingRoles }),
  );

  const users = Object.values(urls)
    .filter(Boolean)
    .map((url) => {
      try {
        return new URL(url).username;
      } catch {
        return "";
      }
    });
  checks.push(
    !missingRoles.length && new Set(users.filter(Boolean)).size === 3
      ? check("db_role_users_distinct", "pass", { users })
      : check("db_role_users_distinct", "fail", { users, missing: missingRoles }),
  );

  if (missingRoles.length) return { checks };

  const readWrite = await probeSqlInTransaction(
    connect,
    urls.read,
    "INSERT INTO batch_state (key, data) VALUES ('_role_separation_probe', '{}')",
  );
  checks.push(
    readWrite === "denied"
      ? check("db_read_role_write_denied", "pass", { probe: "batch_state_insert" })
      : check("db_read_role_write_denied", "fail", { probe: "batch_state_insert", outcome: readWrite }),
  );

  const ingestDdl = await probeSqlInTransaction(
    connect,
    urls.ingest,
    "CREATE TABLE _role_separation_probe (id TEXT)",
  );
  checks.push(
    ingestDdl === "denied"
      ? check("db_ingest_role_ddl_denied", "pass", { probe: "create_table" })
      : check("db_ingest_role_ddl_denied", "fail", { probe: "create_table", outcome: ingestDdl }),
  );

  const migrationDdl = await probeSqlInTransaction(
    connect,
    urls.migration,
    "CREATE TABLE _role_separation_probe (id TEXT)",
  );
  checks.push(
    migrationDdl === "allowed"
      ? check("db_migration_role_ddl_allowed", "pass", { probe: "create_table" })
      : check("db_migration_role_ddl_allowed", "fail", { probe: "create_table", outcome: migrationDdl }),
  );

  return { checks };
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function auditHttpReadiness(options = {}) {
  const checks = [];
  if (options.sourceHealthUrl) {
    const response = await fetchJson(options.sourceHealthUrl, options.timeoutMs);
    checks.push(
      response.ok && response.body?.status === "ready"
        ? check("http_source_health_ready", "pass", { status_code: response.status, status: response.body.status })
        : check("http_source_health_ready", "fail", { status_code: response.status, body: response.body }),
    );
  }
  if (options.searchUrl) {
    const response = await fetchJson(options.searchUrl, options.timeoutMs);
    const diagnostics = response.body?.diagnostics ?? {};
    checks.push(
      response.ok && diagnostics.read_model === "postgres" && diagnostics.fallback_used === false
        ? check("http_search_postgres_read_model", "pass", {
          status_code: response.status,
          read_model: diagnostics.read_model,
          fallback_used: diagnostics.fallback_used,
        })
        : check("http_search_postgres_read_model", "fail", { status_code: response.status, diagnostics }),
    );
    checks.push(
      response.ok && Number(response.body?.data?.total_offers ?? 0) > 0
        ? check("http_search_returns_offers", "pass", { total_offers: response.body.data.total_offers })
        : check("http_search_returns_offers", "fail", { status_code: response.status, total_offers: response.body?.data?.total_offers ?? null }),
    );
  }
  return { checks };
}

export function summarizeReadiness(sections) {
  const checks = sections.flatMap((section) => section.checks ?? []);
  const failed = checks.filter((item) => item.status === "fail");
  const warned = checks.filter((item) => item.status === "warn");
  assert.equal(checks.every((item) => ["pass", "warn", "fail"].includes(item.status)), true);
  return {
    status: failed.length === 0 ? "ready" : "not_ready",
    checks_total: checks.length,
    passed: checks.filter((item) => item.status === "pass").length,
    warned: warned.length,
    failed: failed.length,
    failed_checks: failed.map((item) => item.name),
    warning_checks: warned.map((item) => item.name),
  };
}

function manifestLoadFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Missing required collector source manifest env/.test(message) ? "missing" : "manifest_load_failed";
}

export function buildManifestLoadFailureReadinessOutput({
  manifestEnv = "",
  manifestPath = "",
  error,
  generatedAt = new Date().toISOString(),
} = {}) {
  const manifestCheck = check("collector_manifest_configured", "fail", {
    manifest_env: manifestEnv || null,
    manifest_path: manifestPath || null,
    reason: manifestLoadFailureReason(error),
    error: error instanceof Error ? error.message : String(error ?? "manifest_load_failed"),
  });
  const summary = summarizeReadiness([{ checks: [manifestCheck] }]);
  return {
    status: summary.status,
    generated_at: generatedAt,
    summary,
    manifest: {
      source_ids: [],
      env_enabled_source_ids: [],
      max_stale_hours: null,
    },
    database: {
      counts: null,
      deeplink_sample: { checked: 0, hosts: [] },
      readiness: null,
    },
    checks: {
      manifest: [manifestCheck],
      database: [],
      http: [],
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let manifest;
  try {
    manifest = args.manifestEnv
      ? await loadCollectorSourceManifestFromEnv(args.manifestEnv)
      : await loadCollectorSourceManifest(args.manifest);
  } catch (err) {
    const output = buildManifestLoadFailureReadinessOutput({
      manifestEnv: args.manifestEnv,
      manifestPath: args.manifest,
      error: err,
    });
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = 1;
    return;
  }
  const manifestAudit = auditCollectorManifest(manifest, args);
  const dbAudit = await auditDatabaseReadiness({
    connectionString: args.databaseUrl,
    sourceIds: manifestAudit.source_ids,
    maxStaleHours: args.maxStaleHours,
    deeplinkSampleSize: args.deeplinkSampleSize,
    allowLocalDeeplinks: args.allowLocalDeeplinks,
    allowPlaceholderDeeplinks: args.allowPlaceholderDeeplinks,
    allowInsecureDeeplinks: args.allowInsecureDeeplinks,
  });
  const roleAudit = await auditDbRoleSeparation({ env: process.env });
  const httpAudit = await auditHttpReadiness({
    sourceHealthUrl: args.sourceHealthUrl || undefined,
    searchUrl: args.searchUrl || undefined,
  });
  const summary = summarizeReadiness([manifestAudit, dbAudit, roleAudit, httpAudit]);
  const output = {
    status: summary.status,
    generated_at: new Date().toISOString(),
    summary,
    manifest: {
      source_ids: manifestAudit.source_ids,
      env_enabled_source_ids: manifestAudit.env_enabled_source_ids,
      max_stale_hours: manifestAudit.max_stale_hours,
    },
    database: {
      counts: dbAudit.counts,
      deeplink_sample: dbAudit.deeplink_sample,
      readiness: dbAudit.readiness,
    },
    checks: {
      manifest: manifestAudit.checks,
      database: dbAudit.checks,
      db_roles: roleAudit.checks,
      http: httpAudit.checks,
    },
  };
  console.log(JSON.stringify(output, null, 2));
  if (summary.status !== "ready") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Production readiness smoke failed.");
    console.error(err);
    process.exit(1);
  });
}
