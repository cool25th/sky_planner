import { pathToFileURL } from "node:url";

import {
  auditCollectorManifest,
} from "./prod-readiness-smoke.mjs";
import {
  loadCollectorSourceManifest,
  loadCollectorSourceManifestFromEnv,
} from "./run-collector-sources.mjs";
import { OPS_READINESS_TOKEN_ENV, opsReadinessTokenFailure } from "../lib/ops-visibility.ts";
import { secretValueFailure } from "../lib/secret-validation.ts";
import { SERVICE_REQUIRE_POSTGRES_ENV, serviceRequirePostgresFailure } from "../lib/service-mode.ts";
import { resolveSupportContact } from "../lib/service-contact.ts";
import { SOURCE_POLICY_CATALOG } from "../lib/source-policy.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org", "example.test"]);
const SOURCE_FLAG_TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const SOURCE_FLAG_FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

function check(name, status, detail = {}) {
  return { name, status, detail };
}

function parseArgs(argv) {
  const args = {
    manifest: "",
    manifestEnv: "COLLECTOR_SOURCE_MANIFEST_JSON",
    allowLocalDatabase: false,
    runtimeOnly: false,
  };
  let manifestSelectorCount = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      args.manifest = argv[index + 1] ?? "";
      args.manifestEnv = "";
      manifestSelectorCount += 1;
      index += 1;
    } else if (arg === "--manifest-env") {
      args.manifestEnv = argv[index + 1] ?? "";
      args.manifest = "";
      manifestSelectorCount += 1;
      index += 1;
    } else if (arg === "--allow-local-database") {
      args.allowLocalDatabase = true;
    } else if (arg === "--runtime-only") {
      args.runtimeOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.runtimeOnly) {
    if (manifestSelectorCount > 0) {
      throw new Error("--runtime-only cannot be combined with --manifest or --manifest-env");
    }
    args.manifestEnv = "";
    return args;
  }
  if (Boolean(args.manifest) === Boolean(args.manifestEnv)) {
    throw new Error("Provide exactly one of --manifest <path> or --manifest-env <env-name>");
  }
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

function productionHttpsUrlCheck(name, rawUrl) {
  if (!rawUrl) return check(name, "fail", { reason: "missing" });
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return check(name, "fail", { reason: "invalid_url" });
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return check(name, "fail", { reason: "not_https", protocol: url.protocol, host });
  if (LOCAL_HOSTS.has(host)) return check(name, "fail", { reason: "local_host", host });
  if (isPlaceholderHost(host)) return check(name, "fail", { reason: "placeholder_host", host });
  return check(name, "pass", { host });
}

function databaseUrlCheck(rawUrl, options = {}) {
  if (!rawUrl) return check("database_url_production_shape", "fail", { reason: "missing" });
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return check("database_url_production_shape", "fail", { reason: "invalid_url" });
  }
  const host = url.hostname.toLowerCase();
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    return check("database_url_production_shape", "fail", { reason: "not_postgres", protocol: url.protocol, host });
  }
  if (LOCAL_HOSTS.has(host) && !options.allowLocalDatabase) {
    return check("database_url_production_shape", "fail", { reason: "local_host", host });
  }
  if (isPlaceholderHost(host)) {
    return check("database_url_production_shape", "fail", { reason: "placeholder_host", host });
  }
  return check("database_url_production_shape", "pass", { host, database: url.pathname.replace(/^\//, "") });
}

function supportEmailCheck(env) {
  const contact = resolveSupportContact(env);
  if (!contact.ok && contact.reason === "missing") {
    return check("support_contact_configured", "fail", { reason: "missing", env_names: ["SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_EMAIL"] });
  }
  if (!contact.ok) {
    return check("support_contact_configured", "fail", { reason: contact.reason, env_name: contact.env_name, host: contact.host });
  }
  return check("support_contact_configured", "pass", { env_name: contact.env_name, host: contact.host });
}

function secretValueCheck(envName, env) {
  const reason = secretValueFailure(env[envName]);
  return reason
    ? check("secret_value_present", "fail", { env_name: envName, reason })
    : check("secret_value_present", "pass", { env_name: envName });
}

function opsReadinessTokenCheck(env) {
  const reason = opsReadinessTokenFailure(env);
  return reason
    ? check("ops_readiness_token_configured", "fail", { env_name: OPS_READINESS_TOKEN_ENV, reason })
    : check("ops_readiness_token_configured", "pass", { env_name: OPS_READINESS_TOKEN_ENV });
}

function mockFallbackDisabledCheck(env) {
  const reason = serviceRequirePostgresFailure(env);
  return reason
    ? check("mock_fallback_disabled", "fail", { env_name: SERVICE_REQUIRE_POSTGRES_ENV, reason })
    : check("mock_fallback_disabled", "pass", { env_name: SERVICE_REQUIRE_POSTGRES_ENV });
}

function sourceKillSwitchesCheck(env) {
  const invalid = [];
  const enabled = [];
  for (const source of SOURCE_POLICY_CATALOG) {
    const raw = env[source.env_flag];
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (!normalized) {
      invalid.push({ source_id: source.source_id, env_name: source.env_flag, reason: "missing" });
    } else if (SOURCE_FLAG_TRUE_VALUES.has(normalized)) {
      enabled.push(source.source_id);
    } else if (!SOURCE_FLAG_FALSE_VALUES.has(normalized)) {
      invalid.push({ source_id: source.source_id, env_name: source.env_flag, reason: "invalid_boolean" });
    }
  }
  if (invalid.length) {
    return check("source_kill_switches_configured", "fail", {
      expected: "true or false for every source policy env flag",
      invalid,
    });
  }
  return check("source_kill_switches_configured", "pass", {
    env_flags: SOURCE_POLICY_CATALOG.map((source) => source.env_flag),
    enabled_source_ids: enabled,
  });
}

function sourceMaxStaleHoursCheck(env) {
  const raw = String(env.SOURCE_MAX_STALE_HOURS ?? "").trim();
  if (!raw) return check("source_max_stale_hours_configured", "fail", { env_name: "SOURCE_MAX_STALE_HOURS", reason: "missing" });
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return check("source_max_stale_hours_configured", "fail", {
      env_name: "SOURCE_MAX_STALE_HOURS",
      reason: "invalid_positive_integer",
    });
  }
  return check("source_max_stale_hours_configured", "pass", { env_name: "SOURCE_MAX_STALE_HOURS", hours: value });
}

function requiredSecretEnvNames(manifest) {
  const names = new Set(["VERCEL_REVALIDATE_SECRET"]);
  for (const source of manifest.sources ?? []) {
    const tokenEnv = source.config?.auth?.token_env;
    if (source.enabled !== false && tokenEnv) names.add(tokenEnv);
  }
  if (manifest.revalidate?.secret_env) names.add(manifest.revalidate.secret_env);
  return [...names].sort();
}

function summarize(checks) {
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

function manifestLoadFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Missing required collector source manifest env/.test(message) ? "missing" : "manifest_load_failed";
}

export function buildServiceEnvPreflightManifestLoadFailure({
  env = process.env,
  manifestEnv = "COLLECTOR_SOURCE_MANIFEST_JSON",
  error,
  allowLocalDatabase = false,
} = {}) {
  const checks = [
    ...runtimeEnvChecks(env, { allowLocalDatabase }),
    secretValueCheck("VERCEL_REVALIDATE_SECRET", env),
    check("collector_manifest_configured", "fail", {
      manifest_env: manifestEnv,
      reason: manifestLoadFailureReason(error),
      error: error instanceof Error ? error.message : String(error ?? "manifest_load_failed"),
    }),
  ];
  const summary = summarize(checks);
  return {
    status: "fail",
    summary,
    enabled_source_ids: [],
    checks,
  };
}

function runtimeEnvChecks(env, options = {}) {
  const checks = [
    databaseUrlCheck(env.DATABASE_URL, { allowLocalDatabase: options.allowLocalDatabase }),
    productionHttpsUrlCheck("ops_alert_webhook_url_configured", env.OPS_ALERT_WEBHOOK_URL),
    supportEmailCheck(env),
    opsReadinessTokenCheck(env),
    mockFallbackDisabledCheck(env),
    sourceKillSwitchesCheck(env),
    sourceMaxStaleHoursCheck(env),
  ];
  if (options.includeRevalidateSecret) {
    checks.push(secretValueCheck("VERCEL_REVALIDATE_SECRET", env));
  }
  return checks;
}

export async function loadManifestForPreflight(options = {}) {
  if (options.manifest) return loadCollectorSourceManifest(options.manifest);
  return loadCollectorSourceManifestFromEnv(options.manifestEnv ?? "COLLECTOR_SOURCE_MANIFEST_JSON", {
    env: options.env,
    baseDir: options.baseDir,
  });
}

export function buildServiceRuntimeEnvPreflight({ env = process.env, allowLocalDatabase = false } = {}) {
  const checks = runtimeEnvChecks(env, {
    allowLocalDatabase,
    includeRevalidateSecret: true,
  });
  const summary = summarize(checks);
  return {
    status: summary.failed === 0 ? "pass" : "fail",
    summary,
    checks,
  };
}

export function buildServiceEnvPreflight({ env = process.env, manifest, allowLocalDatabase = false }) {
  const manifestAudit = auditCollectorManifest(manifest, { env });
  const checks = [
    ...runtimeEnvChecks(env, { allowLocalDatabase }),
    ...requiredSecretEnvNames(manifest).map((envName) => secretValueCheck(envName, env)),
    ...manifestAudit.checks,
  ];
  const summary = summarize(checks);
  return {
    status: summary.failed === 0 ? "pass" : "fail",
    summary,
    enabled_source_ids: manifestAudit.source_ids,
    checks,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.runtimeOnly) {
    const output = buildServiceRuntimeEnvPreflight({
      env: process.env,
      allowLocalDatabase: args.allowLocalDatabase,
    });
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== "pass") process.exitCode = 1;
    return;
  }
  let manifest;
  try {
    manifest = await loadManifestForPreflight({
      manifest: args.manifest,
      manifestEnv: args.manifestEnv,
    });
  } catch (err) {
    const output = buildServiceEnvPreflightManifestLoadFailure({
      env: process.env,
      manifestEnv: args.manifestEnv || args.manifest,
      error: err,
      allowLocalDatabase: args.allowLocalDatabase,
    });
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = 1;
    return;
  }
  const output = buildServiceEnvPreflight({
    env: process.env,
    manifest,
    allowLocalDatabase: args.allowLocalDatabase,
  });
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Service environment preflight failed.");
    console.error(err);
    process.exit(1);
  });
}
