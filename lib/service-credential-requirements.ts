import { readFileSync } from "node:fs";
import path from "node:path";

export type SourceCredentialRequirements = Record<string, string[]>;

export interface SourceCredentialRequirementSnapshot {
  requirements: SourceCredentialRequirements | null;
  manifest_env: string;
  configured: boolean;
  error: string | null;
}

interface CollectorSourceConfigForCredentials {
  source_id?: string;
  source_type?: string;
  auth?: {
    token_env?: string;
  };
}

interface CollectorManifestSourceForCredentials {
  enabled?: boolean;
  config_path?: string;
  config?: CollectorSourceConfigForCredentials;
}

interface CollectorManifestForCredentials {
  schema_version?: string;
  sources?: CollectorManifestSourceForCredentials[];
}

function hasNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function loadConfigPathSource(configPath: string, baseDir: string) {
  const resolvedPath = path.resolve(baseDir, configPath);
  return JSON.parse(readFileSync(resolvedPath, "utf-8")) as CollectorSourceConfigForCredentials;
}

function validateSourceSelector(source: CollectorManifestSourceForCredentials, index: number) {
  const hasConfig = Boolean(source.config);
  const hasConfigPath = hasNonEmptyString(source.config_path);
  if (hasConfig === hasConfigPath) {
    throw new Error(`manifest source ${index + 1} must provide exactly one of config or config_path`);
  }
}

function sourceConfigForCredentialRequirement(
  source: CollectorManifestSourceForCredentials,
  baseDir: string,
) {
  if (source.config) return source.config;
  if (source.config_path) return loadConfigPathSource(source.config_path, baseDir);
  return null;
}

function validateSourceConfig(config: CollectorSourceConfigForCredentials | null, index: number) {
  if (!config || !hasNonEmptyString(config.source_id)) {
    throw new Error(`manifest source ${index + 1} is missing config.source_id`);
  }
  const tokenEnv = String(config.auth?.token_env ?? "").trim();
  if (!tokenEnv && config.source_type !== "promo_page") {
    throw new Error(`manifest source ${index + 1} non-promo config must provide auth.token_env`);
  }
}

export function sourceCredentialRequirementsFromManifest(
  manifest: CollectorManifestForCredentials,
  options: { baseDir?: string } = {},
) {
  if (manifest.schema_version !== "collector.source_manifest.v1") {
    throw new Error("manifest schema_version must be collector.source_manifest.v1");
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error("manifest sources must contain at least one source");
  }
  const requirements: SourceCredentialRequirements = {};
  const activeSourceIds = new Set<string>();
  const baseDir = options.baseDir ?? process.cwd();
  for (const [index, source] of manifest.sources.entries()) {
    validateSourceSelector(source, index);
    const config = sourceConfigForCredentialRequirement(source, baseDir);
    validateSourceConfig(config, index);
    if (source.enabled === false) continue;
    const sourceId = String(config?.source_id ?? "").trim();
    if (activeSourceIds.has(sourceId)) {
      throw new Error(`manifest source ${index + 1} duplicates active config.source_id ${sourceId}`);
    }
    activeSourceIds.add(sourceId);
    const tokenEnv = String(config?.auth?.token_env ?? "").trim();
    requirements[sourceId] = tokenEnv ? [tokenEnv] : [];
  }
  return requirements;
}

export function sourceCredentialRequirementsFromManifestEnv(
  env: Record<string, string | undefined>,
  manifestEnv = "COLLECTOR_SOURCE_MANIFEST_JSON",
  options: { baseDir?: string } = {},
): SourceCredentialRequirementSnapshot {
  const raw = env[manifestEnv];
  if (!raw) {
    return {
      requirements: null,
      manifest_env: manifestEnv,
      configured: false,
      error: null,
    };
  }

  try {
    const manifest = JSON.parse(raw) as CollectorManifestForCredentials;
    const requirements = sourceCredentialRequirementsFromManifest(manifest, options);
    return {
      requirements,
      manifest_env: manifestEnv,
      configured: true,
      error: null,
    };
  } catch (err) {
    return {
      requirements: null,
      manifest_env: manifestEnv,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
