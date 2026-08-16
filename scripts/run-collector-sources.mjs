import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { REVALIDATE_SECRET_HEADER } from "../lib/revalidate-auth.ts";
import {
  collectorDatabaseUrl,
  ingestCollectorBatch,
  recordCollectorRunBatchState,
  summarizeCollectorBatch,
} from "./ingest-collector-batch.mjs";
import {
  classifyCollectorFailure,
  collectAuthorizedFeed,
  loadCollectorConfig,
  recordCollectorFailure,
  writeCollectorArtifacts,
} from "./run-authorized-feed-collector.mjs";

const SourceTypeSchema = z.enum(["meta_search", "airline_official", "promo_page"]);
const QueryValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const RevalidateConfigSchema = z.object({
  url: z.string().url(),
  secret_env: z.string().min(1).default("VERCEL_REVALIDATE_SECRET"),
  secret: z.string().optional(),
  timeout_ms: z.number().int().positive().default(10000),
}).optional();
const InlineSourceConfigSchema = z.object({
  schema_version: z.literal("collector.authorized_feed_source.v1"),
  source_id: z.string().min(1),
  source_type: SourceTypeSchema,
  parser_version: z.string().optional(),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).optional(),
  timeout_ms: z.number().int().positive().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  retry_base_delay_ms: z.number().int().positive().optional(),
  retry_max_delay_ms: z.number().int().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), QueryValueSchema).optional(),
  body: z.unknown().optional(),
  artifact_prefix: z.string().optional(),
  response_mapping: z.unknown().optional(),
  auth: z.object({
    header_name: z.string().min(1),
    token_env: z.string().min(1),
    value_prefix: z.string().optional(),
  }).optional(),
}).superRefine((config, ctx) => {
  if (config.source_type !== "promo_page" && !config.auth) {
    ctx.addIssue({
      code: "custom",
      path: ["auth"],
      message: "non-promo source requires auth.token_env",
    });
  }
});

const ManifestSourceSchema = z.object({
  enabled: z.boolean().default(true),
  config_path: z.string().min(1).optional(),
  config: InlineSourceConfigSchema.optional(),
}).refine((source) => Boolean(source.config_path) !== Boolean(source.config), {
  message: "Each manifest source must provide exactly one of config_path or config",
});

const CollectorSourceManifestSchema = z.object({
  schema_version: z.literal("collector.source_manifest.v1"),
  run_id: z.string().optional(),
  artifact_root: z.string().default("runtime/collector-artifacts"),
  revalidate: RevalidateConfigSchema,
  sources: z.array(ManifestSourceSchema).min(1),
});

function compactUtc(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function sourceLabel(source, index) {
  return source.config?.source_id ?? source.config_path ?? `source_${index}`;
}

async function resolveCollectorSourceManifest(payload, baseDir) {
  const manifest = CollectorSourceManifestSchema.parse(payload);
  return {
    ...manifest,
    sources: await Promise.all(manifest.sources.map(async (source) => {
      if (source.config) return { ...source, config: source.config };
      const configPath = path.resolve(baseDir, source.config_path);
      return {
        enabled: source.enabled,
        config: await loadCollectorConfig(configPath),
      };
    })),
  };
}

function revalidateConfigFromOptions(manifest, options) {
  if (options.revalidateUrl) {
    return {
      url: options.revalidateUrl,
      secret_env: options.revalidateSecretEnv ?? "VERCEL_REVALIDATE_SECRET",
      secret: options.revalidateSecret,
      timeout_ms: options.revalidateTimeoutMs ?? 10000,
    };
  }
  return manifest.revalidate;
}

export async function triggerRevalidation(inputConfig) {
  const config = RevalidateConfigSchema.parse(inputConfig);
  if (!config) return null;
  const secret = config.secret ?? process.env[config.secret_env];
  if (!secret) throw new Error(`Missing required revalidation secret env ${config.secret_env}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        [REVALIDATE_SECRET_HEADER]: secret,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Revalidation returned ${response.status}: ${text.slice(0, 300)}`);
    }
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 300);
    }
    return {
      status: "revalidated",
      http_status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCollectorSourceManifest(manifestPath) {
  const payload = JSON.parse(await readFile(manifestPath, "utf-8"));
  return resolveCollectorSourceManifest(payload, path.dirname(path.resolve(manifestPath)));
}

export async function loadCollectorSourceManifestFromEnv(envName, options = {}) {
  const raw = (options.env ?? process.env)[envName];
  if (!raw) throw new Error(`Missing required collector source manifest env ${envName}`);
  return resolveCollectorSourceManifest(JSON.parse(raw), options.baseDir ?? process.cwd());
}

export async function runCollectorSources(manifest, options = {}) {
  const parsed = CollectorSourceManifestSchema.parse(manifest);
  const startedAt = options.now ?? new Date();
  const runId = safeSegment(options.runId ?? parsed.run_id ?? `collector_run_${compactUtc(startedAt)}`);
  const results = [];
  const ingestBatch = options.ingestBatch ?? ingestCollectorBatch;
  const recordRunBatchState = options.recordRunBatchState ?? recordCollectorRunBatchState;

  for (const [index, source] of parsed.sources.entries()) {
    const label = sourceLabel(source, index);
    if (!source.enabled) {
      results.push({
        status: "skipped",
        source_id: label,
        reason: "disabled",
      });
      continue;
    }

    let config;
    const sourceStartedAt = new Date();
    try {
      if (source.config) {
        config = source.config;
      } else if (source.config_path) {
        config = await loadCollectorConfig(source.config_path);
      } else {
        throw new Error("Missing source config");
      }
      const sourceId = safeSegment(config.source_id);
      const executionId = `${runId}_${sourceId}`;
      const artifactPrefix = path.join(parsed.artifact_root, runId, sourceId);
      const { batch, raw_payload, fetch_summary } = await collectAuthorizedFeed(config, {
        executionId,
        artifactPrefix,
      });
      const artifacts = await writeCollectorArtifacts(batch, raw_payload, { artifactDir: artifactPrefix });
      const writeSummary = options.ingest
        ? await ingestBatch(batch, {
          connectionString: options.connectionString,
          rollback: options.rollback,
        })
        : { status: "validated", ...summarizeCollectorBatch(batch) };

      results.push({
        ...writeSummary,
        source_id: config.source_id,
        fetch_summary,
        artifacts,
      });
    } catch (err) {
      const failureCode = classifyCollectorFailure(err);
      let audit = null;
      if (options.auditFailure && config) {
        audit = await recordCollectorFailure(config, err, {
          connectionString: collectorDatabaseUrl(options),
          rollback: options.rollback,
          executionId: `${runId}_${safeSegment(config.source_id)}_failed`,
          startedAt: sourceStartedAt.toISOString(),
          completedAt: new Date().toISOString(),
          failureCode,
          artifactPrefix: path.join(parsed.artifact_root, runId, safeSegment(config.source_id)),
        });
      }
      results.push({
        status: "failed",
        source_id: config?.source_id ?? label,
        failure_code: failureCode,
        error: err instanceof Error ? err.message : String(err),
        audit,
      });
    }
  }

  const succeeded = results.filter((result) => ["validated", "committed", "rolled_back"].includes(result.status)).length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const revalidateConfig = revalidateConfigFromOptions(parsed, options);
  const status = failed === 0 ? "success" : succeeded > 0 ? "completed_with_failures" : "failed";
  let revalidation = null;
  if (status === "success" && succeeded > 0 && revalidateConfig) {
    try {
      revalidation = await triggerRevalidation(revalidateConfig);
    } catch (err) {
      revalidation = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else if (revalidateConfig && succeeded === 0) {
    revalidation = {
      status: "skipped",
      reason: "no_successful_sources",
    };
  } else if (revalidateConfig) {
    revalidation = {
      status: "skipped",
      reason: "source_failures_present",
    };
  }

  const finalStatus = status === "success" && revalidation?.status === "failed" ? "revalidation_failed" : status;
  const succeededSourceIds = results
    .filter((result) => ["validated", "committed", "rolled_back"].includes(result.status))
    .map((result) => result.source_id)
    .filter(Boolean)
    .sort();
  const failedSourceIds = results
    .filter((result) => result.status === "failed")
    .map((result) => result.source_id)
    .filter(Boolean)
    .sort();
  const manifestSourceIds = [...new Set([...succeededSourceIds, ...failedSourceIds])].sort();
  const skippedSourceIds = results
    .filter((result) => result.status === "skipped")
    .map((result) => result.source_id)
    .filter(Boolean)
    .sort();
  const completedAt = new Date();
  const aggregateLastBatch = {
    status: finalStatus,
    generated_at: completedAt.toISOString(),
    last_batch_at: completedAt.toISOString(),
    run_id: runId,
    source_flags: succeededSourceIds,
    manifest_source_ids: manifestSourceIds,
    succeeded_source_ids: succeededSourceIds,
    failed_source_ids: failedSourceIds,
    skipped_source_ids: skippedSourceIds,
    sources_total: results.length,
    succeeded,
    failed,
    skipped,
    revalidation_status: revalidation?.status ?? null,
  };
  const batchState = options.ingest && !options.rollback
    ? await recordRunBatchState(aggregateLastBatch, {
      connectionString: options.connectionString,
    })
    : null;

  return {
    status: finalStatus,
    run_id: runId,
    sources_total: results.length,
    succeeded,
    failed,
    skipped,
    revalidation,
    batch_state: batchState,
    results,
  };
}

function parseArgs(argv) {
  const args = {
    manifest: "",
    manifestEnv: "",
    ingest: false,
    rollback: false,
    auditFailure: false,
    allowPartial: false,
    revalidateUrl: "",
    revalidateSecretEnv: "VERCEL_REVALIDATE_SECRET",
    revalidateTimeoutMs: 10000,
    databaseUrl: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      args.manifest = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--manifest-env") {
      args.manifestEnv = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--ingest") {
      args.ingest = true;
    } else if (arg === "--rollback") {
      args.rollback = true;
      args.ingest = true;
    } else if (arg === "--audit-failure") {
      args.auditFailure = true;
    } else if (arg === "--allow-partial") {
      args.allowPartial = true;
    } else if (arg === "--revalidate-url") {
      args.revalidateUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--revalidate-secret-env") {
      args.revalidateSecretEnv = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--revalidate-timeout-ms") {
      args.revalidateTimeoutMs = Number(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--dry-run") {
      args.ingest = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (Boolean(args.manifest) === Boolean(args.manifestEnv)) {
    throw new Error("Provide exactly one of --manifest <path> or --manifest-env <env-name>");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = args.manifestEnv
    ? await loadCollectorSourceManifestFromEnv(args.manifestEnv)
    : await loadCollectorSourceManifest(args.manifest);
  const summary = await runCollectorSources(manifest, {
    ingest: args.ingest,
    rollback: args.rollback,
    auditFailure: args.auditFailure,
    connectionString: args.databaseUrl || undefined,
    revalidateUrl: args.revalidateUrl || undefined,
    revalidateSecretEnv: args.revalidateSecretEnv,
    revalidateTimeoutMs: args.revalidateTimeoutMs,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 && !args.allowPartial) process.exitCode = 1;
  if (summary.revalidation?.status === "failed" && !args.allowPartial) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Collector source manifest run failed.");
    console.error(err);
    process.exit(1);
  });
}
