import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MANIFEST_ENV = "COLLECTOR_SOURCE_MANIFEST_JSON";
const DEFAULT_OUTPUT_DIR = "runtime/service-launch-audits";
const SUPPORT_CONTACT_ENV = "SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_EMAIL";
const SOURCE_SECRET_ENV = "source token_env secrets referenced by manifest";
const SOURCE_KILL_SWITCH_ENV = "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED";
const SOURCE_MAX_STALE_HOURS_ENV = "SOURCE_MAX_STALE_HOURS";
const OPS_READINESS_TOKEN_ENV = "OPS_READINESS_TOKEN";
const SERVICE_REQUIRE_POSTGRES_ENV = "SERVICE_REQUIRE_POSTGRES";
const MAX_OUTPUT_TAIL_CHARS = 12000;
const REVALIDATE_SECRET_ENV = "VERCEL_REVALIDATE_SECRET";
const SENSITIVE_REPORT_KEY_PATTERN = /(^|[_-])(secret|password|credential|api[_-]?key|database[_-]?url|webhook[_-]?url|authorization|token)$/i;

function parseArgs(argv) {
  const args = {
    manifestEnv: DEFAULT_MANIFEST_ENV,
    runCollector: false,
    verifyReleaseGates: false,
    dryRun: false,
    continueOnFailure: false,
    outputPath: "",
    outputDir: "",
    envFile: "",
    databaseUrl: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest-env") {
      args.manifestEnv = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--run-collector") {
      args.runCollector = true;
    } else if (arg === "--verify-release-gates") {
      args.verifyReleaseGates = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--continue-on-failure") {
      args.continueOnFailure = true;
    } else if (arg === "--output") {
      args.outputPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.manifestEnv) throw new Error("--manifest-env must not be empty");
  if (args.outputPath === "") delete args.outputPath;
  if (args.outputDir === "") delete args.outputDir;
  if (args.envFile === "") delete args.envFile;
  if (args.databaseUrl === "") delete args.databaseUrl;
  return args;
}

function unquoteEnvValue(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2 && (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEnvFile(contents) {
  const env = {};
  for (const [index, rawLine] of String(contents ?? "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid env file line ${index + 1}`);
    }
    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env name on line ${index + 1}`);
    }
    env[key] = unquoteEnvValue(withoutExport.slice(separator + 1));
  }
  return env;
}

export async function loadAuditEnvOverrides(options = {}) {
  const overrides = {};
  if (options.envFile) {
    Object.assign(overrides, parseEnvFile(await readFile(options.envFile, "utf-8")));
  }
  if (options.databaseUrl) {
    overrides.DATABASE_URL = options.databaseUrl;
  }
  return overrides;
}

function envInputSummary(envOverrides = {}, options = {}) {
  return {
    env_file_provided: Boolean(options.envFile),
    database_url_provided: Boolean(options.databaseUrl),
    provided_env_names: Object.keys(envOverrides).sort(),
  };
}

function withHiddenRunCommand(step, runCommand) {
  Object.defineProperty(step, "run_command", {
    value: runCommand,
    enumerable: false,
    configurable: true,
  });
  return step;
}

function withDatabaseUrlArg(command, databaseUrl) {
  if (!databaseUrl) return { display: command, run: command };
  return {
    display: [...command, "--database-url", "[REDACTED_DATABASE_URL]"],
    run: [...command, "--database-url", databaseUrl],
  };
}

function directNodeCommand(scriptPath, args = []) {
  return [process.execPath, "--experimental-strip-types", scriptPath, ...args];
}

function timestampSegment(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function defaultReportPath(report, outputDir = DEFAULT_OUTPUT_DIR) {
  const mode = report.mode ?? (report.plan?.run_collector ? "run-collector" : "audit");
  return path.join(outputDir, `service-launch-${mode}-${timestampSegment(new Date(report.generated_at))}.json`);
}

function reportPathForDecision(report, options = {}) {
  return String(options.reportPath ?? report?.report_path ?? "").trim();
}

export async function writeServiceLaunchReport(report, options = {}) {
  const generatedAt = report.generated_at ?? new Date().toISOString();
  const payload = { generated_at: generatedAt, ...report };
  const safePayload = redactSensitiveReportValue(payload, options.redactionEnv);
  const outputPath = options.outputPath ?? defaultReportPath(payload, options.outputDir);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(safePayload, null, 2)}\n`);
  return outputPath;
}

export function buildServiceLaunchPlan(options = {}) {
  const manifestEnv = options.manifestEnv ?? DEFAULT_MANIFEST_ENV;
  const databaseUrl = options.databaseUrl ?? "";
  const verifyReleaseGates = Boolean(options.verifyReleaseGates);
  const releaseGateStepIds = ["js_contract_tests", "python_backend_tests", "production_build"];
  const steps = [
    ...(verifyReleaseGates ? [
      {
        id: "js_contract_tests",
        command: ["npm", "test"],
        required_env: [],
        release_gate: true,
      },
      {
        id: "python_backend_tests",
        command: ["python3", "-m", "unittest", "discover", "-s", "tests"],
        required_env: [],
        release_gate: true,
      },
      {
        id: "production_build",
        command: ["npm", "run", "build"],
        required_env: [],
        release_gate: true,
      },
    ] : []),
    {
      id: "runtime_env_preflight",
      command: ["npm", "run", "preflight:runtime-env", "--"],
      required_env: ["DATABASE_URL", "OPS_ALERT_WEBHOOK_URL", SUPPORT_CONTACT_ENV, OPS_READINESS_TOKEN_ENV, SERVICE_REQUIRE_POSTGRES_ENV, "VERCEL_REVALIDATE_SECRET", SOURCE_KILL_SWITCH_ENV, SOURCE_MAX_STALE_HOURS_ENV],
    },
    {
      id: "service_env_preflight",
      command: ["npm", "run", "preflight:service-env", "--", "--manifest-env", manifestEnv],
      required_env: ["DATABASE_URL", manifestEnv, "OPS_ALERT_WEBHOOK_URL", SUPPORT_CONTACT_ENV, OPS_READINESS_TOKEN_ENV, SERVICE_REQUIRE_POSTGRES_ENV, "VERCEL_REVALIDATE_SECRET", SOURCE_SECRET_ENV, SOURCE_KILL_SWITCH_ENV, SOURCE_MAX_STALE_HOURS_ENV],
    },
    {
      id: "ops_alert_delivery",
      command: ["npm", "run", "smoke:ops-alert", "--", "--event", "collector_ops_alert_smoke"],
      required_env: ["OPS_ALERT_WEBHOOK_URL"],
    },
  ];

  if (options.runCollector) {
    const collectorArgs = [
      "--manifest-env",
      manifestEnv,
      "--ingest",
      "--audit-failure",
      "--allow-partial",
    ];
    const collectorCommand = withDatabaseUrlArg([
      "npm",
      "run",
      "collector:sources",
      "--",
      ...collectorArgs,
    ], databaseUrl);
    steps.push({
      id: "collect_approved_sources",
      mutates_database: true,
      requires_pass: [
        ...(verifyReleaseGates ? releaseGateStepIds : []),
        "runtime_env_preflight",
        "service_env_preflight",
        "ops_alert_delivery",
      ],
      required_env: ["DATABASE_URL", manifestEnv, "VERCEL_REVALIDATE_SECRET", SOURCE_SECRET_ENV],
      command: collectorCommand.display,
    });
    withHiddenRunCommand(
      steps.at(-1),
      databaseUrl
        ? directNodeCommand("scripts/run-collector-sources.mjs", [...collectorArgs, "--database-url", databaseUrl])
        : collectorCommand.run,
    );
  }

  const prodReadinessArgs = ["--manifest-env", manifestEnv];
  const serviceReadinessArgs = ["--manifest-env", manifestEnv, "--notify"];
  const prodReadinessCommand = withDatabaseUrlArg(
    ["npm", "run", "smoke:prod-readiness", "--", ...prodReadinessArgs],
    databaseUrl,
  );
  const serviceReadinessCommand = withDatabaseUrlArg(
    ["npm", "run", "smoke:service-readiness", "--", ...serviceReadinessArgs],
    databaseUrl,
  );

  steps.push(
    withHiddenRunCommand({
      id: "production_readiness",
      command: prodReadinessCommand.display,
      required_env: ["DATABASE_URL", manifestEnv, "VERCEL_REVALIDATE_SECRET", SOURCE_SECRET_ENV, SOURCE_KILL_SWITCH_ENV, SOURCE_MAX_STALE_HOURS_ENV],
    }, databaseUrl
      ? directNodeCommand("scripts/prod-readiness-smoke.mjs", [...prodReadinessArgs, "--database-url", databaseUrl])
      : prodReadinessCommand.run),
    withHiddenRunCommand({
      id: "service_readiness",
      command: serviceReadinessCommand.display,
      required_env: ["DATABASE_URL", manifestEnv, "OPS_ALERT_WEBHOOK_URL", SUPPORT_CONTACT_ENV, OPS_READINESS_TOKEN_ENV, SERVICE_REQUIRE_POSTGRES_ENV, SOURCE_SECRET_ENV, SOURCE_KILL_SWITCH_ENV, SOURCE_MAX_STALE_HOURS_ENV],
    }, databaseUrl
      ? directNodeCommand("scripts/service-readiness-smoke.mjs", [...serviceReadinessArgs, "--database-url", databaseUrl])
      : serviceReadinessCommand.run),
  );

  return {
    manifest_env: manifestEnv,
    run_collector: Boolean(options.runCollector),
    verify_release_gates: verifyReleaseGates,
    steps,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sensitiveEnvValues(env) {
  return Object.entries(env)
    .filter(([key, value]) => (
      value &&
      String(value).length >= 4 &&
      /SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL|WEBHOOK|CREDENTIAL|MANIFEST/i.test(key)
    ))
    .map(([, value]) => String(value))
    .sort((left, right) => right.length - left.length);
}

export function redactSensitiveOutput(value, env = process.env) {
  let output = String(value ?? "");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]");
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
  output = output.replace(
    /\b(Authorization|X-Revalidate-Secret|X-API-Key|X-Auth-Token|X-Ops-Readiness-Token)\s*:\s*[^\r\n"']+/gi,
    "$1: [REDACTED]",
  );
  output = output.replace(/([?&](?:secret|token|api[_-]?key|key|password)=)[^&\s"']+/gi, "$1[REDACTED]");
  output = output.replace(
    /("(?!token[_-]?env\b)(?:[A-Za-z0-9_-]*(?:secret|password|credential|api[_-]?key|database[_-]?url|webhook[_-]?url|authorization)|[A-Z0-9_]*TOKEN)"\s*:\s*)"([^"]*)"/gi,
    '$1"[REDACTED]"',
  );
  output = output.replace(
    /\b((?!TOKEN_ENV\b)[A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|WEBHOOK_URL))=([^\s"']+)/gi,
    "$1=[REDACTED]",
  );
  for (const secret of sensitiveEnvValues(env)) {
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }
  return output;
}

function isSensitiveReportKey(key) {
  const normalized = String(key ?? "").trim();
  if (!normalized || /token[_-]?env$/i.test(normalized)) return false;
  return (
    SENSITIVE_REPORT_KEY_PATTERN.test(normalized) ||
    /^[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|WEBHOOK_URL)$/i.test(normalized)
  );
}

export function redactSensitiveReportValue(value, env = process.env, key = "") {
  if (value === null || value === undefined) return value;
  if (isSensitiveReportKey(key)) {
    if (Array.isArray(value)) return value.map(() => "[REDACTED]");
    if (typeof value === "object") return "[REDACTED]";
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactSensitiveOutput(value, env);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveReportValue(item, env, key));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => (
      key === "run_command"
        ? [key, "[REDACTED_COMMAND]"]
        : [key, redactSensitiveReportValue(entryValue, env, key)]
    )));
  }
  return value;
}

function createRedactedStreamWriter(write, env) {
  let buffer = "";
  return {
    write(chunk) {
      buffer += String(chunk);
      const lineBreak = Math.max(buffer.lastIndexOf("\n"), buffer.lastIndexOf("\r"));
      if (lineBreak < 0) return;
      const flushable = buffer.slice(0, lineBreak + 1);
      buffer = buffer.slice(lineBreak + 1);
      write(redactSensitiveOutput(flushable, env));
    },
    flush() {
      if (!buffer) return;
      write(redactSensitiveOutput(buffer, env));
      buffer = "";
    },
  };
}

function outputTail(value, env) {
  const redacted = redactSensitiveOutput(value, env);
  return {
    tail: redacted.slice(-MAX_OUTPUT_TAIL_CHARS),
    truncated: redacted.length > MAX_OUTPUT_TAIL_CHARS,
  };
}

function parsedJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      if (depth > 0) inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Ignore non-JSON brace groups from progress logs and keep scanning.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].sort()
    : [];
}

function sanitizeOperatorActions(value) {
  if (!Array.isArray(value)) return null;
  const actions = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const check = String(item.check ?? "").trim();
    if (!check) return [];
    return [{
      check,
      ...(Number.isFinite(Number(item.priority)) ? { priority: Number(item.priority) } : {}),
      ...(typeof item.phase === "string" && item.phase ? { phase: item.phase } : {}),
      ...(typeof item.area === "string" && item.area ? { area: item.area } : {}),
      ...(typeof item.axis === "string" && item.axis ? { axis: item.axis } : {}),
      ...(typeof item.axis_label === "string" && item.axis_label ? { axis_label: item.axis_label } : {}),
      ...(typeof item.status === "string" && item.status ? { status: item.status } : {}),
      ...(typeof item.action === "string" && item.action ? { action: item.action } : {}),
      ...(typeof item.operator_action === "string" && item.operator_action ? { operator_action: item.operator_action } : {}),
      ...(typeof item.verify === "string" && item.verify ? { verify: item.verify } : {}),
      ...(Array.isArray(item.verify_command) ? { verify_command: item.verify_command.map((part) => String(part)) } : {}),
      ...(stringArray(item.required_env).length ? { required_env: stringArray(item.required_env) } : {}),
      ...(stringArray(item.affected_sources).length ? { affected_sources: stringArray(item.affected_sources) } : {}),
      ...(typeof item.reason === "string" && item.reason ? { reason: item.reason } : {}),
      ...(stringArray(item.reason).length ? { reason: stringArray(item.reason) } : {}),
    }];
  });
  return actions.length ? actions : null;
}

export function parseServiceLaunchJsonSummary(stdout) {
  const text = String(stdout ?? "").trim();
  const parsed = parsedJsonObjects(text).at(-1);
  if (!parsed) return null;
  const operatorActions = sanitizeOperatorActions(parsed.operator_actions);
  const structuredEvidence = Object.fromEntries(Object.entries({
    generated_at: parsed.generated_at,
    axes: parsed.axes,
    checks: parsed.checks,
    database: parsed.database,
    manifest: parsed.manifest,
    metrics: parsed.metrics,
    validation: parsed.validation,
  }).filter(([, value]) => value !== undefined && value !== null));
  return {
    status: parsed.status ?? null,
    summary: parsed.summary ?? null,
    failed_checks: parsed.summary?.failed_checks ?? parsed.failed_checks ?? null,
    launch_blockers: parsed.launch_blockers ?? null,
    operator_actions: operatorActions,
    evidence: Object.keys(structuredEvidence).length > 0 ? structuredEvidence : null,
    sent: parsed.sent ?? null,
    run_id: parsed.run_id ?? null,
    succeeded: parsed.succeeded ?? null,
    failed: parsed.failed ?? null,
    skipped: parsed.skipped ?? null,
  };
}

function remediationCatalog(manifestEnv) {
  const serviceEnvPreflightCommand = ["npm", "run", "preflight:service-env", "--", "--manifest-env", manifestEnv];
  const runtimePreflightCommand = ["npm", "run", "preflight:runtime-env", "--"];
  const serviceReadinessCommand = ["npm", "run", "smoke:service-readiness", "--", "--manifest-env", manifestEnv, "--notify"];
  const launchAuditCollectorCommand = [
    "npm",
    "run",
    "audit:service-launch",
    "--",
    "--manifest-env",
    manifestEnv,
    "--verify-release-gates",
    "--run-collector",
    "--continue-on-failure",
    "--output-dir",
    DEFAULT_OUTPUT_DIR,
  ];
  const alertSmokeCommand = ["npm", "run", "smoke:ops-alert", "--", "--event", "collector_ops_alert_smoke"];
  const prodReadinessCommand = ["npm", "run", "smoke:prod-readiness", "--", "--manifest-env", manifestEnv];

  return {
    database_url_production_shape: {
      required_env: ["DATABASE_URL"],
      operator_action: "운영 PostgreSQL DATABASE_URL을 주입합니다.",
      verify_command: runtimePreflightCommand,
    },
    postgres_database_url_configured: {
      required_env: ["DATABASE_URL"],
      operator_action: "운영 PostgreSQL DATABASE_URL을 주입합니다.",
      verify_command: prodReadinessCommand,
    },
    postgres_read_model_configured: {
      required_env: ["DATABASE_URL"],
      operator_action: "서비스 read model이 바라볼 운영 PostgreSQL DATABASE_URL을 주입합니다.",
      verify_command: serviceReadinessCommand,
    },
    postgres_read_model_queryable: {
      required_env: ["DATABASE_URL"],
      operator_action: "운영 PostgreSQL 연결, 권한, schema migration 상태를 복구합니다.",
      verify_command: serviceReadinessCommand,
    },
    postgres_required_tables: {
      required_env: ["DATABASE_URL"],
      operator_action: "운영 PostgreSQL schema migration을 적용해 필수 read model 테이블을 준비합니다.",
      verify_command: prodReadinessCommand,
    },
    places_seeded: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "운영 read model에 장소 seed와 collector 결과를 적재합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    active_offers_present: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "활성 offer 재고가 생성되도록 승인 source collector를 실행합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    active_deals_present: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "현재 deal 캐시가 생성되도록 승인 source collector를 실행합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    ops_alert_webhook_url_configured: {
      required_env: ["OPS_ALERT_WEBHOOK_URL"],
      operator_action: "실제 HTTPS 운영 알림 webhook을 설정합니다.",
      verify_command: alertSmokeCommand,
    },
    alert_channel_configured: {
      required_env: ["OPS_ALERT_WEBHOOK_URL"],
      operator_action: "실제 HTTPS 운영 알림 webhook을 설정하고 전송을 확인합니다.",
      verify_command: alertSmokeCommand,
    },
    support_contact_configured: {
      required_env: [SUPPORT_CONTACT_ENV],
      operator_action: "실제 수신 가능한 support email을 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    ops_readiness_token_configured: {
      required_env: [OPS_READINESS_TOKEN_ENV],
      operator_action: "내부 ops JSON 접근용 토큰을 16자 이상의 비-placeholder 값으로 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    mock_fallback_disabled: {
      required_env: [SERVICE_REQUIRE_POSTGRES_ENV],
      operator_action: "운영 API가 mock fallback을 사용하지 않도록 SERVICE_REQUIRE_POSTGRES=true를 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    source_kill_switches_configured: {
      required_env: [SOURCE_KILL_SWITCH_ENV],
      operator_action: "source별 kill switch를 모두 명시적인 true/false 값으로 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    source_max_stale_hours_configured: {
      required_env: [SOURCE_MAX_STALE_HOURS_ENV],
      operator_action: "SOURCE_MAX_STALE_HOURS를 양의 정수 시간 값으로 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    source_kill_switches_invalid: {
      required_env: [SOURCE_KILL_SWITCH_ENV],
      operator_action: "source별 kill switch를 모두 명시적인 true/false 값으로 설정해 source readiness fallback을 차단합니다.",
      verify_command: runtimePreflightCommand,
    },
    source_max_stale_hours_invalid: {
      required_env: [SOURCE_MAX_STALE_HOURS_ENV],
      operator_action: "SOURCE_MAX_STALE_HOURS를 양의 정수 시간 값으로 설정해 source freshness readiness 기준을 확정합니다.",
      verify_command: runtimePreflightCommand,
    },
    secret_value_present: {
      required_env: [REVALIDATE_SECRET_ENV],
      operator_action: "revalidation secret을 16자 이상의 비-placeholder 값으로 설정합니다.",
      verify_command: runtimePreflightCommand,
    },
    revalidation_secret_present: {
      required_env: [REVALIDATE_SECRET_ENV],
      operator_action: "manifest revalidation secret env가 16자 이상의 실제 secret을 가리키도록 설정합니다.",
      verify_command: prodReadinessCommand,
    },
    revalidation_configured: {
      required_env: [manifestEnv, REVALIDATE_SECRET_ENV],
      operator_action: "source manifest에 revalidate.url과 secret_env를 운영 배포 origin 기준으로 설정합니다.",
      verify_command: prodReadinessCommand,
    },
    revalidation_url_production_shape: {
      required_env: [manifestEnv],
      operator_action: "manifest revalidation URL을 HTTPS 운영 origin으로 교체합니다.",
      verify_command: prodReadinessCommand,
    },
    revalidation_url_uses_header_secret: {
      required_env: [manifestEnv],
      operator_action: "revalidation secret을 URL query가 아니라 Authorization 또는 x-revalidate-secret header로만 전달하도록 manifest를 수정합니다.",
      verify_command: prodReadinessCommand,
    },
    collector_manifest_configured: {
      required_env: [manifestEnv],
      operator_action: "실제 partner endpoint, artifact_root, revalidation 설정이 들어간 source manifest를 주입합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    source_auth_secret_present: {
      required_env: [SOURCE_SECRET_ENV],
      operator_action: "manifest의 auth.token_env가 가리키는 source API secret을 16자 이상의 비-placeholder 값으로 주입합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    source_credentials_present: {
      required_env: [SOURCE_SECRET_ENV],
      operator_action: "활성 source별 API credential secret을 16자 이상의 비-placeholder 값으로 주입합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    source_endpoint_not_placeholder: {
      required_env: [manifestEnv],
      operator_action: "manifest source endpoint를 localhost/example/test가 아닌 승인된 HTTPS partner endpoint로 교체합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    source_enabled_by_env: {
      required_env: [manifestEnv, SOURCE_KILL_SWITCH_ENV],
      operator_action: "manifest에 포함된 운영 source가 env kill switch로 비활성화되지 않았는지 확인합니다.",
      verify_command: prodReadinessCommand,
    },
    source_in_policy_catalog: {
      required_env: [manifestEnv],
      operator_action: "manifest source_id가 SOURCE_POLICY_CATALOG에 등록되어 env flag와 booking source alias를 가질 수 있게 합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    source_policy_catalog_coverage: {
      required_env: [manifestEnv],
      operator_action: "service readiness scope의 모든 source_id를 SOURCE_POLICY_CATALOG에 등록합니다.",
      verify_command: serviceReadinessCommand,
    },
    manifest_artifact_root_uploadable: {
      required_env: [manifestEnv],
      operator_action: "manifest artifact_root를 workflow가 업로드하는 runtime/collector-artifacts 아래로 설정합니다.",
      verify_command: serviceEnvPreflightCommand,
    },
    live_collector_success: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "승인 feed collector를 실행해 local-mock이 아닌 parser_version과 runtime/collector-artifacts artifact ref를 source_jobs에 남깁니다.",
      verify_command: launchAuditCollectorCommand,
    },
    collector_success_rate_7d: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "최근 7일 동안 활성 source별 live collector 성공 이력을 확보하고 성공률 95% 이상을 유지합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    fresh_successful_batch: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "승인 source collector batch를 다시 실행해 last_batch를 성공 상태로 갱신합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    last_batch_source_coverage: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "collector run 단위 last_batch.source_flags가 활성 source 전체를 포함하도록 승인 source collector batch를 다시 실행합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    last_batch_success: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "승인 source collector batch를 다시 실행해 last_batch를 성공 상태로 갱신합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    last_batch_fresh: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "승인 source collector batch를 다시 실행해 last_batch freshness를 갱신합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    last_batch_includes_manifest_sources: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "collector run 단위 last_batch.source_flags가 manifest active source 전체를 포함하도록 배치를 다시 실행합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    eligible_sources_minimum: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "검색 가능한 승인 source를 2개 이상 확보하고 source health를 ready 상태로 복구합니다.",
      verify_command: serviceReadinessCommand,
    },
    inventory_present: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "활성 offers와 deals_current를 운영 read model에 적재합니다.",
      verify_command: serviceReadinessCommand,
    },
    search_inventory_available: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "사용자 검색에 노출 가능한 활성 deals_current 재고를 확보합니다.",
      verify_command: serviceReadinessCommand,
    },
    booking_deeplink_sample_present: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "활성 offer의 예약 deeplink 샘플을 확보합니다.",
      verify_command: serviceReadinessCommand,
    },
    booking_deeplink_sample_depth: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "활성 source마다 추적 파라미터를 제외한 고유 예약 deeplink 샘플을 최소 5건 이상 확보합니다.",
      verify_command: serviceReadinessCommand,
    },
    booking_deeplink_shape: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "예약 deeplink를 HTTPS 운영 host로 정규화하고 localhost/example/test host를 제거합니다.",
      verify_command: serviceReadinessCommand,
    },
    booking_deeplink_source_coverage: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "활성 source마다 예약 deeplink 샘플이 적재되도록 collector mapping을 보완합니다.",
      verify_command: serviceReadinessCommand,
    },
    source_health_ready: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "stale, paused, circuit-open source 상태를 해소합니다.",
      verify_command: ["npm", "run", "smoke:source-health", "--", "--database-url", "[REDACTED_DATABASE_URL]"],
    },
    manifest_sources_have_health: {
      required_env: ["DATABASE_URL", manifestEnv, SOURCE_SECRET_ENV],
      operator_action: "manifest active source마다 source_health row가 생성되도록 collector를 실행합니다.",
      verify_command: launchAuditCollectorCommand,
    },
    source_readiness_ready: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "source health readiness가 ready가 되도록 stale, paused, circuit-open 상태를 해소합니다.",
      verify_command: ["npm", "run", "smoke:source-health", "--", "--database-url", "[REDACTED_DATABASE_URL]"],
    },
    manifest_sources_unblocked: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "manifest active source가 source health에서 blocked 상태가 아니도록 복구합니다.",
      verify_command: ["npm", "run", "smoke:source-health", "--", "--database-url", "[REDACTED_DATABASE_URL]"],
    },
    booking_deeplink_production_shape: {
      required_env: ["DATABASE_URL", manifestEnv],
      operator_action: "예약 deeplink를 HTTPS 운영 host로 정규화하고 localhost/example/test host를 제거합니다.",
      verify_command: prodReadinessCommand,
    },
  };
}

function fallbackRemediation(checkName, stepIds, plan) {
  const requiredEnv = [...new Set(stepIds.flatMap((stepId) => (
    plan.steps.find((step) => step.id === stepId)?.required_env ?? []
  )))];
  if (checkName === "step:ops_alert_delivery") {
    return {
      required_env: requiredEnv,
      operator_action: "ops alert smoke output의 validation/status를 확인하고 실제 운영 webhook 전송 경로를 복구합니다.",
      verify_command: ["npm", "run", "smoke:ops-alert", "--", "--event", "collector_ops_alert_smoke"],
    };
  }
  if (checkName === "step:js_contract_tests") {
    return {
      required_env: [],
      operator_action: "JS 계약 테스트 실패를 수정하고 전체 계약 테스트를 다시 실행합니다.",
      verify_command: ["npm", "test"],
    };
  }
  if (checkName === "step:python_backend_tests") {
    return {
      required_env: [],
      operator_action: "Python backend unittest 실패를 수정하고 backend 테스트를 다시 실행합니다.",
      verify_command: ["python3", "-m", "unittest", "discover", "-s", "tests"],
    };
  }
  if (checkName === "step:production_build") {
    return {
      required_env: [],
      operator_action: "Next production build 실패를 수정하고 production build를 다시 실행합니다.",
      verify_command: ["npm", "run", "build"],
    };
  }
  return {
    required_env: requiredEnv,
    operator_action: `${checkName} 실패 detail을 step output에서 확인하고 해당 gate를 복구합니다.`,
    verify_command: null,
  };
}

function stepById(plan, stepId) {
  return plan.steps.find((step) => step.id === stepId) ?? null;
}

function resultById(results, stepId) {
  return results.find((result) => result.id === stepId) ?? null;
}

function preflightStatusIsPass(value) {
  return value === "pass";
}

function decisionBlockerActionItems(results, plan, options = {}) {
  const items = [];
  const add = (check, stepId, operatorAction, verifyCommand) => {
    const step = stepById(plan, stepId);
    items.push({
      check,
      seen_in_steps: stepId ? [stepId] : [],
      required_env: step?.required_env ?? [],
      operator_action: operatorAction,
      verify_command: verifyCommand ?? step?.command ?? null,
    });
  };

  const runtimeEnv = resultById(results, "runtime_env_preflight");
  const serviceEnv = resultById(results, "service_env_preflight");
  const productionReadiness = resultById(results, "production_readiness");
  const serviceReadiness = resultById(results, "service_readiness");
  const opsAlert = resultById(results, "ops_alert_delivery");
  const collector = resultById(results, "collect_approved_sources");
  const collectorSummary = collector?.output?.json_summary ?? null;
  const collectorSucceeded = Number(collectorSummary?.succeeded);
  const collectorFailed = Number(collectorSummary?.failed);
  const skippedStepIds = results.filter((result) => result.status === "skipped").map((result) => result.id);
  const releaseGateStepIds = ["js_contract_tests", "python_backend_tests", "production_build"];
  const failedReleaseGateStepIds = plan.verify_release_gates
    ? releaseGateStepIds.filter((stepId) => resultById(results, stepId)?.status !== "pass")
    : [];
  const hasFailedCheckDetails = (result) => Array.isArray(result?.output?.json_summary?.failed_checks) && result.output.json_summary.failed_checks.length > 0;

  if ((!runtimeEnv || runtimeEnv.status !== "pass" || !preflightStatusIsPass(runtimeEnv.output?.json_summary?.status)) && !hasFailedCheckDetails(runtimeEnv)) {
    add(
      "runtime_env_preflight_not_pass",
      "runtime_env_preflight",
      "runtime env preflight JSON summary가 통과 상태인지 확인합니다.",
    );
  }
  if ((!serviceEnv || serviceEnv.status !== "pass" || !preflightStatusIsPass(serviceEnv.output?.json_summary?.status)) && !hasFailedCheckDetails(serviceEnv)) {
    add(
      "service_env_preflight_not_pass",
      "service_env_preflight",
      "service env preflight JSON summary가 통과 상태인지 확인합니다.",
    );
  }
  if ((!productionReadiness || productionReadiness.status !== "pass" || productionReadiness.output?.json_summary?.status !== "ready") && !hasFailedCheckDetails(productionReadiness)) {
    add(
      "production_readiness_not_ready",
      "production_readiness",
      "production readiness JSON summary가 ready가 되도록 manifest, DB, deeplink, revalidation 설정을 복구합니다.",
    );
  }
  if ((!serviceReadiness || serviceReadiness.status !== "pass" || serviceReadiness.output?.json_summary?.status !== "ready") && !hasFailedCheckDetails(serviceReadiness)) {
    add(
      "service_readiness_not_ready",
      "service_readiness",
      "service readiness JSON summary가 ready가 되도록 남은 launch blocker를 해소합니다.",
    );
  }
  if (!opsAlert || opsAlert.status !== "pass" || opsAlert.output?.json_summary?.sent !== true) {
    add(
      "ops_alert_not_sent",
      "ops_alert_delivery",
      "ops alert smoke가 실제 webhook 전송 성공을 증명하도록 알림 채널을 복구합니다.",
    );
  }
  if (failedReleaseGateStepIds.length > 0) {
    items.push({
      check: "release_gates_not_pass",
      seen_in_steps: failedReleaseGateStepIds,
      required_env: [],
      operator_action: "JS/Python 계약 테스트와 production build가 모두 통과하도록 실패 release gate를 복구합니다.",
      verify_command: redactedAuditRerunCommand(plan, options),
    });
  }
  if (skippedStepIds.length > 0) {
    items.push({
      check: "skipped_steps_present",
      seen_in_steps: skippedStepIds,
      required_env: [...new Set(skippedStepIds.flatMap((stepId) => stepById(plan, stepId)?.required_env ?? []))],
      operator_action: "skipped step의 failed_prerequisite를 확인하고 선행 gate를 복구한 뒤 cutover audit를 다시 실행합니다.",
      verify_command: redactedCutoverCommand(plan, options),
    });
  }
  if (!plan.run_collector) {
    items.push({
      check: "collector_audit_missing",
      seen_in_steps: [],
      required_env: [
        "DATABASE_URL",
        plan.manifest_env ?? DEFAULT_MANIFEST_ENV,
        "OPS_ALERT_WEBHOOK_URL",
        SUPPORT_CONTACT_ENV,
        OPS_READINESS_TOKEN_ENV,
        SERVICE_REQUIRE_POSTGRES_ENV,
        REVALIDATE_SECRET_ENV,
        SOURCE_SECRET_ENV,
        SOURCE_KILL_SWITCH_ENV,
        SOURCE_MAX_STALE_HOURS_ENV,
      ],
      operator_action: "실제 collector DB write를 포함한 cutover audit를 실행해 live source 증거를 남깁니다.",
      verify_command: redactedCutoverCommand(plan, options),
    });
  } else if (collector) {
    if (collector.status !== "pass") {
      add(
        "collector_step_not_pass",
        "collect_approved_sources",
        "collector step의 exit/status와 source별 실패 사유를 확인하고 승인 source 수집이 DB write까지 완료되도록 복구합니다.",
        redactedCutoverCommand(plan, options),
      );
    }
    if (collectorSummary?.status !== "success") {
      add(
        "collector_run_not_success",
        "collect_approved_sources",
        "collector JSON summary가 success가 되도록 승인 source 수집 실행을 복구합니다.",
        redactedCutoverCommand(plan, options),
      );
    }
    if (!Number.isFinite(collectorSucceeded) || collectorSucceeded <= 0) {
      add(
        "collector_sources_missing",
        "collect_approved_sources",
        "collector JSON summary에 성공 source 수가 1개 이상 남도록 source 수집을 복구합니다.",
        redactedCutoverCommand(plan, options),
      );
    }
    if (!Number.isFinite(collectorFailed) || collectorFailed !== 0) {
      add(
        "collector_sources_failed",
        "collect_approved_sources",
        "collector JSON summary에 실패 source가 없도록 source별 실패 원인을 해소합니다.",
        redactedCutoverCommand(plan, options),
      );
    }
  }
  if (options.requireReleaseGateEvidence && !plan.verify_release_gates) {
    items.push({
      check: "release_gates_missing",
      seen_in_steps: [],
      required_env: [],
      operator_action: "launch audit를 --verify-release-gates와 함께 실행해 JS/Python 계약 테스트와 production build 증거를 같은 cutover report에 남깁니다.",
      verify_command: redactedCutoverCommand(plan, options),
    });
  }
  if (options.requireEvidenceReport && !reportPathForDecision(null, options)) {
    items.push({
      check: "evidence_report_missing",
      seen_in_steps: [],
      required_env: [],
      operator_action: "서비스 launch audit를 --output 또는 --output-dir와 함께 실행해 cutover evidence JSON을 저장합니다.",
      verify_command: redactedAuditRerunCommand(plan, options),
    });
  }
  const evidenceChecklistRequired = Boolean(options.requireEvidenceChecklist ?? options.requireEvidenceReport);
  if (evidenceChecklistRequired) {
    const evidenceChecklist = buildServiceLaunchEvidenceChecklist(plan, {
      ...options,
      results,
      mode: options.mode ?? "audit",
      reportPath: reportPathForDecision(null, options),
    });
    const missingEvidence = evidenceChecklist.filter((item) => item.status !== "present");
    if (missingEvidence.length > 0) {
      items.push({
        check: "evidence_checklist_not_present",
        seen_in_steps: [...new Set(missingEvidence.flatMap((item) => item.required_steps ?? []))].filter((stepId) => stepId !== "write_service_launch_report").sort(),
        required_env: [...new Set(missingEvidence.flatMap((item) => item.required_env ?? []))].sort(),
        operator_action: "launch audit evidence_checklist의 모든 항목이 present가 되도록 release gate, alert, collector, readiness, report 보존 증거를 같은 cutover report에 남깁니다.",
        verify_command: redactedCutoverCommand(plan, options),
        missing_evidence_ids: missingEvidence.map((item) => item.id).sort(),
      });
    }
  }

  return items;
}

function redactedAuditRerunCommand(plan, options = {}) {
  const command = [
    "npm",
    "run",
    "audit:service-launch",
    "--",
    "--manifest-env",
    plan.manifest_env ?? DEFAULT_MANIFEST_ENV,
    "--continue-on-failure",
  ];
  if (plan.run_collector) command.push("--run-collector");
  if (plan.verify_release_gates) command.push("--verify-release-gates");
  if (options.envFile) command.push("--env-file", "[REDACTED_ENV_FILE]");
  if (options.databaseUrl) command.push("--database-url", "[REDACTED_DATABASE_URL]");
  command.push("--output-dir", DEFAULT_OUTPUT_DIR);
  return command;
}

function redactedCutoverCommand(plan, options = {}) {
  return redactedAuditRerunCommand({
    ...plan,
    run_collector: true,
    verify_release_gates: true,
  }, options);
}

function sourceTokenEnvNamesFromAuditEnv(manifestEnv, options = {}) {
  const raw = options.envOverrides?.[manifestEnv] ?? process.env[manifestEnv];
  if (!raw) return [];
  try {
    const manifest = JSON.parse(String(raw));
    const baseDir = options.baseDir ?? process.cwd();
    return [...new Set((manifest.sources ?? [])
      .filter((source) => source?.enabled !== false)
      .map((source) => {
        if (source?.config) return source.config;
        if (!source?.config_path) return null;
        const configPath = path.resolve(baseDir, source.config_path);
        return JSON.parse(readFileSync(configPath, "utf-8"));
      })
      .map((config) => String(config?.auth?.token_env ?? "").trim())
      .filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function envRequirementDescriptor(name, manifestEnv, options = {}) {
  if (name === SUPPORT_CONTACT_ENV) {
    return {
      id: "support_contact",
      requirement: "one_of",
      env_names: ["SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_EMAIL"],
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "production support email; example/test domains rejected",
    };
  }
  if (name === SOURCE_SECRET_ENV) {
    const sourceTokenEnvNames = sourceTokenEnvNamesFromAuditEnv(manifestEnv, options);
    return {
      id: "source_token_env_secrets",
      requirement: "all_manifest_token_envs",
      env_names: sourceTokenEnvNames.length ? sourceTokenEnvNames : ["manifest auth.token_env values"],
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "non-placeholder partner/API secret with at least 16 characters referenced by collector manifest",
    };
  }
  if (name === SOURCE_KILL_SWITCH_ENV) {
    return {
      id: "source_kill_switches",
      requirement: "all",
      env_names: [
        "SOURCE_SKYSCANNER_ENABLED",
        "SOURCE_KOREAN_AIR_ENABLED",
        "SOURCE_ASIANA_ENABLED",
        "SOURCE_GOOGLE_FLIGHTS_ENABLED",
        "SOURCE_KAYAK_ENABLED",
        "SOURCE_PROMO_PAGES_ENABLED",
      ],
      deployment_targets: ["GitHub Actions env", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "true for enabled production sources; false only for deliberate kill switch",
    };
  }
  if (name === SOURCE_MAX_STALE_HOURS_ENV) {
    return {
      id: "SOURCE_MAX_STALE_HOURS",
      requirement: "exact",
      env_names: [SOURCE_MAX_STALE_HOURS_ENV],
      deployment_targets: ["GitHub Actions env", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "positive integer hours; 24 is the default production freshness window",
    };
  }

  const descriptors = {
    DATABASE_URL: {
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "managed PostgreSQL URL; localhost rejected for production readiness",
    },
    [manifestEnv]: {
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "collector.source_manifest.v1 JSON with production HTTPS endpoints and runtime/collector-artifacts root",
    },
    OPS_ALERT_WEBHOOK_URL: {
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "production HTTPS webhook URL; localhost/example/test rejected",
    },
    [OPS_READINESS_TOKEN_ENV]: {
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "non-placeholder token with at least 16 characters",
    },
    [SERVICE_REQUIRE_POSTGRES_ENV]: {
      deployment_targets: ["GitHub Actions env", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "true",
    },
    [REVALIDATE_SECRET_ENV]: {
      deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
      value_shape: "non-placeholder revalidation secret with at least 16 characters sent by header only",
    },
  };
  const descriptor = descriptors[name] ?? {
    deployment_targets: ["GitHub Actions secret", "Vercel environment variable", "local rehearsal env file"],
    value_shape: "non-placeholder production value",
  };
  return {
    id: name,
    requirement: "exact",
    env_names: [name],
    ...descriptor,
  };
}

function buildEnvChecklist(items, plan, options = {}) {
  const manifestEnv = plan.manifest_env ?? DEFAULT_MANIFEST_ENV;
  const providedNames = new Set(Object.keys(options.envOverrides ?? {}));
  const byId = new Map();
  for (const item of items) {
    for (const required of item.required_env ?? []) {
      const descriptor = envRequirementDescriptor(required, manifestEnv, options);
      const existing = byId.get(descriptor.id) ?? {
        ...descriptor,
        required_by_checks: [],
        verify_commands: [],
      };
      existing.required_by_checks = [...new Set([...existing.required_by_checks, item.check])].sort();
      if (Array.isArray(item.verify_command)) {
        const serialized = JSON.stringify(item.verify_command);
        const seen = new Set(existing.verify_commands.map((command) => JSON.stringify(command)));
        if (!seen.has(serialized)) existing.verify_commands.push(item.verify_command);
      }
      existing.provided_in_rehearsal =
        descriptor.requirement === "all_manifest_token_envs" && !descriptor.env_names.includes("manifest auth.token_env values")
          ? descriptor.env_names.every((envName) => providedNames.has(envName))
          : descriptor.env_names.some((envName) => providedNames.has(envName));
      byId.set(descriptor.id, existing);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function buildServiceLaunchEnvChecklist(plan, options = {}) {
  const manifestEnv = plan.manifest_env ?? DEFAULT_MANIFEST_ENV;
  const providedNames = new Set(Object.keys(options.envOverrides ?? {}));
  const byId = new Map();
  for (const step of plan.steps ?? []) {
    for (const required of step.required_env ?? []) {
      const descriptor = envRequirementDescriptor(required, manifestEnv, options);
      const existing = byId.get(descriptor.id) ?? {
        ...descriptor,
        required_by_steps: [],
        verify_commands: [],
      };
      existing.required_by_steps = [...new Set([...existing.required_by_steps, step.id])].sort();
      if (Array.isArray(step.command)) {
        const serialized = JSON.stringify(step.command);
        const seen = new Set(existing.verify_commands.map((command) => JSON.stringify(command)));
        if (!seen.has(serialized)) existing.verify_commands.push(step.command);
      }
      existing.provided_in_rehearsal =
        descriptor.requirement === "all_manifest_token_envs" && !descriptor.env_names.includes("manifest auth.token_env values")
          ? descriptor.env_names.every((envName) => providedNames.has(envName))
          : descriptor.env_names.some((envName) => providedNames.has(envName));
      byId.set(descriptor.id, existing);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function evidenceStatusForSteps(plan, results, stepIds, predicate, options = {}) {
  const included = options.included ?? stepIds.every((stepId) => Boolean(stepById(plan, stepId)));
  if (!included) return "missing";
  if (!Array.isArray(results)) return "planned";
  const stepResults = stepIds.map((stepId) => resultById(results, stepId));
  if (stepResults.some((result) => !result)) return "missing";
  return predicate(stepResults) ? "present" : "missing";
}

function evidenceCommands(plan, stepIds, fallbackCommand = null) {
  const commands = stepIds
    .map((stepId) => stepById(plan, stepId)?.command)
    .filter((command) => Array.isArray(command));
  return commands.length ? commands : fallbackCommand ? [fallbackCommand] : [];
}

function statusFromSummary(result, expectedStatus) {
  return result?.status === "pass" && result.output?.json_summary?.status === expectedStatus;
}

export function buildServiceLaunchEvidenceChecklist(plan, options = {}) {
  const results = Array.isArray(options.results) ? options.results : null;
  const mode = options.mode ?? "audit";
  const reportPath = String(options.reportPath ?? "").trim();
  const releaseGateStepIds = ["js_contract_tests", "python_backend_tests", "production_build"];
  const cutoverCommand = redactedCutoverCommand(plan, options);
  const serviceReadinessReady = (result) => statusFromSummary(result, "ready");
  const productionReadinessReady = (result) => statusFromSummary(result, "ready");
  const collectorRunSucceeded = (result) => {
    const summary = result?.output?.json_summary ?? null;
    return (
      result?.status === "pass" &&
      summary?.status === "success" &&
      Number(summary?.succeeded) > 0 &&
      Number(summary?.failed) === 0
    );
  };
  const persistedReportStatus = mode === "dry-run"
    ? reportPath ? "planned" : "missing"
    : reportPath ? "present" : "missing";

  return [
    {
      id: "release_gate_evidence",
      area: "release_quality",
      status: evidenceStatusForSteps(plan, results, releaseGateStepIds, (stepResults) => (
        stepResults.every((result) => result.status === "pass")
      ), { included: Boolean(plan.verify_release_gates) }),
      required_steps: releaseGateStepIds,
      required_env: [],
      evidence_shape: "npm test, python unittest, and production build pass records in the same launch audit report",
      verify_commands: evidenceCommands(plan, releaseGateStepIds, cutoverCommand),
    },
    {
      id: "runtime_env_preflight_evidence",
      area: "runtime_configuration",
      status: evidenceStatusForSteps(plan, results, ["runtime_env_preflight"], ([result]) => (
        statusFromSummary(result, "pass")
      )),
      required_steps: ["runtime_env_preflight"],
      required_env: stepById(plan, "runtime_env_preflight")?.required_env ?? [],
      evidence_shape: "runtime env preflight JSON summary with status=pass",
      verify_commands: evidenceCommands(plan, ["runtime_env_preflight"]),
    },
    {
      id: "service_env_preflight_evidence",
      area: "source_configuration",
      status: evidenceStatusForSteps(plan, results, ["service_env_preflight"], ([result]) => (
        statusFromSummary(result, "pass")
      )),
      required_steps: ["service_env_preflight"],
      required_env: stepById(plan, "service_env_preflight")?.required_env ?? [],
      evidence_shape: "service env preflight JSON summary with status=pass and production source manifest credentials present",
      verify_commands: evidenceCommands(plan, ["service_env_preflight"]),
    },
    {
      id: "ops_alert_delivery_evidence",
      area: "operations",
      status: evidenceStatusForSteps(plan, results, ["ops_alert_delivery"], ([result]) => (
        result.status === "pass" && result.output?.json_summary?.sent === true
      )),
      required_steps: ["ops_alert_delivery"],
      required_env: stepById(plan, "ops_alert_delivery")?.required_env ?? [],
      evidence_shape: "ops alert smoke JSON summary with sent=true and webhook validation pass",
      verify_commands: evidenceCommands(plan, ["ops_alert_delivery"]),
    },
    {
      id: "collector_cutover_evidence",
      area: "source_collection",
      status: evidenceStatusForSteps(plan, results, ["collect_approved_sources"], ([result]) => (
        collectorRunSucceeded(result)
      ), { included: Boolean(plan.run_collector) }),
      required_steps: ["collect_approved_sources"],
      required_env: stepById(plan, "collect_approved_sources")?.required_env ?? [
        "DATABASE_URL",
        plan.manifest_env ?? DEFAULT_MANIFEST_ENV,
        SOURCE_SECRET_ENV,
      ],
      evidence_shape: "collector JSON summary with status=success, succeeded>0, failed=0, and DB ingest enabled",
      verify_commands: evidenceCommands(plan, ["collect_approved_sources"], cutoverCommand),
    },
    {
      id: "production_readiness_evidence",
      area: "production_configuration",
      status: evidenceStatusForSteps(plan, results, ["production_readiness"], ([result]) => (
        productionReadinessReady(result)
      )),
      required_steps: ["production_readiness"],
      required_env: stepById(plan, "production_readiness")?.required_env ?? [],
      evidence_shape: "production readiness JSON summary with status=ready across manifest, DB, deeplink, and revalidation checks",
      verify_commands: evidenceCommands(plan, ["production_readiness"]),
    },
    {
      id: "service_readiness_evidence",
      area: "service_readiness",
      status: evidenceStatusForSteps(plan, results, ["service_readiness"], ([result]) => (
        serviceReadinessReady(result)
      )),
      required_steps: ["service_readiness"],
      required_env: stepById(plan, "service_readiness")?.required_env ?? [],
      evidence_shape: "service readiness JSON summary with status=ready across all service axes",
      verify_commands: evidenceCommands(plan, ["service_readiness"]),
    },
    {
      id: "collector_history_evidence",
      area: "source_collection",
      status: evidenceStatusForSteps(plan, results, ["service_readiness"], ([result]) => (
        serviceReadinessReady(result)
      )),
      required_steps: ["service_readiness"],
      required_checks: ["live_collector_success", "collector_success_rate_7d", "last_batch_source_coverage"],
      required_env: stepById(plan, "service_readiness")?.required_env ?? [],
      evidence_shape: "recent 7 day source_jobs evidence with live collector success for every active source and success rate >=95%",
      verify_commands: evidenceCommands(plan, ["service_readiness"], cutoverCommand),
    },
    {
      id: "deeplink_sample_evidence",
      area: "booking_conversion",
      status: evidenceStatusForSteps(plan, results, ["production_readiness", "service_readiness"], ([productionResult, serviceResult]) => (
        productionReadinessReady(productionResult) && serviceReadinessReady(serviceResult)
      )),
      required_steps: ["production_readiness", "service_readiness"],
      required_checks: [
        "booking_deeplink_sample_present",
        "booking_deeplink_sample_depth",
        "booking_deeplink_shape",
        "booking_deeplink_source_coverage",
        "booking_deeplink_production_shape",
      ],
      required_env: [
        ...new Set([
          ...(stepById(plan, "production_readiness")?.required_env ?? []),
          ...(stepById(plan, "service_readiness")?.required_env ?? []),
        ]),
      ],
      evidence_shape: "valid canonical booking deeplink samples for every active source with at least 5 unique samples per source and broken rate <=5%",
      verify_commands: evidenceCommands(plan, ["production_readiness", "service_readiness"]),
    },
    {
      id: "persisted_launch_report",
      area: "audit_retention",
      status: persistedReportStatus,
      required_steps: ["write_service_launch_report"],
      required_env: [],
      evidence_shape: "non-dry-run service launch audit JSON persisted under runtime/service-launch-audits and uploaded as service-launch-audit artifact",
      verify_commands: [cutoverCommand],
      report_path: reportPath || null,
      dry_run_report_is_not_cutover_evidence: mode === "dry-run",
    },
  ].sort((left, right) => left.id.localeCompare(right.id));
}

export function buildServiceLaunchDecision(report, options = {}) {
  const plan = report.plan ?? report;
  const results = report.results ?? [];
  const actionPlan = report.action_plan ?? null;
  const failedSteps = actionPlan?.failed_steps ?? results.filter((result) => result.status === "fail").map((result) => result.id);
  const skippedSteps = actionPlan?.skipped_steps ?? results.filter((result) => result.status === "skipped").map((result) => result.id);
  const runtimeEnvResult = results.find((result) => result.id === "runtime_env_preflight") ?? null;
  const runtimeEnvSummary = runtimeEnvResult?.output?.json_summary ?? null;
  const serviceEnvResult = results.find((result) => result.id === "service_env_preflight") ?? null;
  const serviceEnvSummary = serviceEnvResult?.output?.json_summary ?? null;
  const productionReadinessResult = results.find((result) => result.id === "production_readiness") ?? null;
  const productionReadinessSummary = productionReadinessResult?.output?.json_summary ?? null;
  const serviceReadinessSummary = results.find((result) => result.id === "service_readiness")?.output?.json_summary ?? null;
  const alertResult = results.find((result) => result.id === "ops_alert_delivery") ?? null;
  const alertSummary = alertResult?.output?.json_summary ?? null;
  const collectorResult = results.find((result) => result.id === "collect_approved_sources") ?? null;
  const collectorSummary = collectorResult?.output?.json_summary ?? null;
  const releaseGateIds = ["js_contract_tests", "python_backend_tests", "production_build"];
  const releaseGateResults = releaseGateIds.map((stepId) => results.find((result) => result.id === stepId) ?? null);
  const releaseGatesIncluded = Boolean(plan.verify_release_gates);
  const releaseGatesRequired = report.mode !== "dry-run";
  const releaseGatesPassed =
    releaseGatesIncluded &&
    releaseGateResults.every((result) => result?.status === "pass");
  const collectorSucceeded = Number.isFinite(Number(collectorSummary?.succeeded))
    ? Number(collectorSummary?.succeeded)
    : null;
  const collectorFailed = Number.isFinite(Number(collectorSummary?.failed))
    ? Number(collectorSummary?.failed)
    : null;
  const blockingChecks = [...new Set((actionPlan?.items ?? []).map((item) => item.check).filter(Boolean))].sort();
  const collectorAuditIncluded = Boolean(plan.run_collector);
  const gateStatus = report.mode === "dry-run" ? "dry_run" : report.status ?? "unknown";
  const runtimeEnvStatus = runtimeEnvSummary?.status ?? null;
  const serviceEnvStatus = serviceEnvSummary?.status ?? null;
  const productionReadinessStatus = productionReadinessSummary?.status ?? null;
  const serviceReadinessStatus = serviceReadinessSummary?.status ?? null;
  const alertDeliverySent = alertSummary?.sent === true;
  const collectorRunStatus = collectorSummary?.status ?? null;
  const evidenceReportPath = reportPathForDecision(report, options);
  const evidenceReportRequired = report.mode !== "dry-run" && Boolean(options.requireEvidenceReport);
  const evidenceReportPersisted = !evidenceReportRequired || Boolean(evidenceReportPath);
  const evidenceChecklistRequired = report.mode !== "dry-run" && Boolean(options.requireEvidenceChecklist ?? options.requireEvidenceReport);
  const evidenceChecklist = buildServiceLaunchEvidenceChecklist(plan, {
    ...options,
    results,
    mode: report.mode ?? "audit",
    reportPath: evidenceReportPath,
  });
  const missingEvidenceChecklistItems = evidenceChecklistRequired
    ? evidenceChecklist.filter((item) => item.status !== "present")
    : [];
  const runtimeEnvReady = runtimeEnvStatus === "pass";
  const serviceEnvReady = serviceEnvStatus === "pass";
  const productionReadinessReady = productionReadinessStatus === "ready";
  const collectorEvidenceComplete =
    collectorAuditIncluded &&
    collectorResult?.status === "pass" &&
    collectorRunStatus === "success" &&
    collectorSucceeded !== null &&
    collectorSucceeded > 0 &&
    collectorFailed === 0;
  const decisionBlockers = [
    ...(gateStatus === "pass" ? [] : [`gate_status_${gateStatus}`]),
    ...(skippedSteps.length > 0 ? ["skipped_steps_present"] : []),
    ...(releaseGatesRequired && !releaseGatesIncluded ? ["release_gates_missing"] : []),
    ...(releaseGatesIncluded && !releaseGatesPassed ? ["release_gates_not_pass"] : []),
    ...(runtimeEnvReady ? [] : ["runtime_env_preflight_not_pass"]),
    ...(serviceEnvReady ? [] : ["service_env_preflight_not_pass"]),
    ...(productionReadinessReady ? [] : ["production_readiness_not_ready"]),
    ...(alertResult?.status === "pass" && alertDeliverySent ? [] : ["ops_alert_not_sent"]),
    ...(collectorAuditIncluded ? [] : ["collector_audit_missing"]),
    ...(collectorAuditIncluded && collectorResult?.status !== "pass" ? ["collector_step_not_pass"] : []),
    ...(collectorAuditIncluded && collectorRunStatus !== "success" ? ["collector_run_not_success"] : []),
    ...(collectorAuditIncluded && !(collectorSucceeded !== null && collectorSucceeded > 0) ? ["collector_sources_missing"] : []),
    ...(collectorAuditIncluded && collectorFailed !== 0 ? ["collector_sources_failed"] : []),
    ...(serviceReadinessStatus === "ready" ? [] : ["service_readiness_not_ready"]),
    ...(evidenceReportPersisted ? [] : ["evidence_report_missing"]),
    ...(missingEvidenceChecklistItems.length === 0 ? [] : ["evidence_checklist_not_present"]),
  ];
  const readyToLaunch =
    decisionBlockers.length === 0 &&
    releaseGatesPassed &&
    collectorEvidenceComplete;
  const decision = readyToLaunch
    ? "ready_to_launch"
    : gateStatus === "pass"
      ? collectorAuditIncluded ? "blocked" : "cutover_audit_required"
      : gateStatus === "dry_run"
        ? "dry_run_only"
        : "blocked";

  return {
    decision,
    ready_to_launch: readyToLaunch,
    gate_status: gateStatus,
    runtime_env_preflight_status: runtimeEnvStatus,
    service_env_preflight_status: serviceEnvStatus,
    production_readiness_status: productionReadinessStatus,
    release_gates_included: releaseGatesIncluded,
    release_gates_passed: releaseGatesPassed,
    js_contract_tests_status: releaseGateResults[0]?.status ?? null,
    python_backend_tests_status: releaseGateResults[1]?.status ?? null,
    production_build_status: releaseGateResults[2]?.status ?? null,
    collector_audit_included: collectorAuditIncluded,
    ops_alert_step_status: alertResult?.status ?? null,
    ops_alert_sent: alertSummary?.sent ?? null,
    collector_step_status: collectorResult?.status ?? null,
    collector_run_status: collectorRunStatus,
    collector_sources_succeeded: collectorSucceeded,
    collector_sources_failed: collectorFailed,
    service_readiness_status: serviceReadinessStatus,
    evidence_report_required: evidenceReportRequired,
    evidence_report_persisted: Boolean(evidenceReportPath),
    evidence_report_path: evidenceReportPath || null,
    evidence_checklist_required: evidenceChecklistRequired,
    evidence_checklist_status: missingEvidenceChecklistItems.length > 0
      ? "missing"
      : evidenceChecklistRequired ? "present" : "not_required",
    evidence_checklist_missing_ids: missingEvidenceChecklistItems.map((item) => item.id).sort(),
    failed_steps: failedSteps,
    skipped_steps: skippedSteps,
    blocking_checks: blockingChecks,
    decision_blockers: [...new Set(decisionBlockers)].sort(),
    required_cutover_command: readyToLaunch ? null : redactedCutoverCommand(plan, options),
  };
}

export function serviceLaunchAuditExitCode(report) {
  if (report?.mode === "dry-run") return 0;
  if (report?.launch_decision?.ready_to_launch !== true) return 1;
  return reportPathForDecision(report, { reportPath: report?.launch_decision?.evidence_report_path }) ? 0 : 1;
}

function operatorActionsByCheck(results) {
  const byCheck = new Map();
  for (const result of results) {
    const actions = result.output?.json_summary?.operator_actions;
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (!action?.check || byCheck.has(action.check)) continue;
      byCheck.set(action.check, action);
    }
  }
  return byCheck;
}

function remediationFromOperatorAction(action, fallback) {
  if (!action) return fallback;
  return {
    required_env: Array.isArray(action.required_env) && action.required_env.length > 0
      ? stringArray(action.required_env)
      : fallback.required_env,
    operator_action: action.operator_action ?? action.action ?? fallback.operator_action,
    verify_command: action.verify_command ?? action.verify ?? fallback.verify_command,
    priority: action.priority,
    phase: action.phase,
  };
}

export function buildServiceLaunchActionPlan(results, plan, options = {}) {
  const catalog = remediationCatalog(plan.manifest_env ?? DEFAULT_MANIFEST_ENV);
  const exactOperatorActions = operatorActionsByCheck(results);
  const failedCheckSteps = new Map();
  for (const result of results) {
    const failedChecks = result.output?.json_summary?.failed_checks;
    if (!Array.isArray(failedChecks)) continue;
    for (const checkName of failedChecks) {
      if (!failedCheckSteps.has(checkName)) failedCheckSteps.set(checkName, []);
      failedCheckSteps.get(checkName).push(result.id);
    }
  }

  const failedSteps = results.filter((result) => result.status === "fail").map((result) => result.id);
  const skippedSteps = results.filter((result) => result.status === "skipped").map((result) => result.id);
  const items = [...failedCheckSteps.entries()].map(([checkName, stepIds]) => {
    const remediation = remediationFromOperatorAction(
      exactOperatorActions.get(checkName),
      catalog[checkName] ?? fallbackRemediation(checkName, stepIds, plan),
    );
    return {
      check: checkName,
      ...(Number.isFinite(Number(remediation.priority)) ? { priority: Number(remediation.priority) } : {}),
      ...(typeof remediation.phase === "string" && remediation.phase ? { phase: remediation.phase } : {}),
      seen_in_steps: [...new Set(stepIds)],
      required_env: remediation.required_env,
      operator_action: remediation.operator_action,
      verify_command: remediation.verify_command,
    };
  });

  const stepsWithCheckItems = new Set([...failedCheckSteps.values()].flat());
  for (const stepId of failedSteps) {
    if (!stepsWithCheckItems.has(stepId)) {
      const remediation = fallbackRemediation(`step:${stepId}`, [stepId], plan);
      items.push({
        check: `step:${stepId}`,
        seen_in_steps: [stepId],
        required_env: remediation.required_env,
        operator_action: remediation.operator_action,
        verify_command: remediation.verify_command,
      });
    }
  }

  const existingChecks = new Set(items.map((item) => item.check));
  for (const item of decisionBlockerActionItems(results, plan, {
    ...options,
    requireReleaseGateEvidence: options.requireReleaseGateEvidence ?? true,
  })) {
    if (!existingChecks.has(item.check)) {
      items.push(item);
      existingChecks.add(item.check);
    }
  }

  return {
    status: items.length === 0 && skippedSteps.length === 0 ? "clear" : "action_required",
    failed_steps: failedSteps,
    skipped_steps: skippedSteps,
    rerun_command: redactedAuditRerunCommand(plan, options),
    env_checklist: buildEnvChecklist(items, plan, options),
    items,
  };
}

function stepEvidence(step, startedAt, result = {}) {
  const completedAt = new Date();
  return {
    id: step.id,
    command: step.command,
    required_env: step.required_env ?? [],
    mutates_database: Boolean(step.mutates_database),
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    ...result,
  };
}

async function executeStep(step, stepRunner) {
  const startedAt = new Date();
  const result = await stepRunner(step);
  return stepEvidence(step, startedAt, result);
}

function runStep(step, options = {}) {
  return new Promise((resolve) => {
    const [command, ...args] = resolveStepCommand(step.run_command ?? step.command);
    const env = childProcessEnv(options.envOverrides);
    const stdoutStream = createRedactedStreamWriter((text) => process.stdout.write(text), env);
    const stderrStream = createRedactedStreamWriter((text) => process.stderr.write(text), env);
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      stdoutStream.write(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      stderrStream.write(text);
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      stdoutStream.flush();
      stderrStream.flush();
      const stdoutTail = outputTail(stdout, env);
      const stderrTail = outputTail(stderr, env);
      resolve({
        ...result,
        output: {
          stdout_tail: stdoutTail.tail,
          stdout_truncated: stdoutTail.truncated,
          stderr_tail: stderrTail.tail,
          stderr_truncated: stderrTail.truncated,
          json_summary: parseServiceLaunchJsonSummary(stdout),
        },
      });
    };
    child.on("error", (err) => {
      finish({
        id: step.id,
        code: null,
        signal: null,
        status: "fail",
        error: err instanceof Error ? err.message : String(err),
      });
    });
    child.on("close", (code, signal) => {
      finish({
        id: step.id,
        code,
        signal,
        status: code === 0 ? "pass" : "fail",
      });
    });
  });
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveStepCommand(commandParts) {
  const [command, ...args] = commandParts;
  if (command !== "npm") return commandParts;
  const npmCli = npmCliPath();
  return npmCli ? [process.execPath, npmCli, ...args] : commandParts;
}

function childProcessEnv(envOverrides = {}) {
  const nodeBinDir = path.dirname(process.execPath);
  const env = {
    ...process.env,
    ...envOverrides,
  };
  const currentPath = env.PATH ?? "";
  const nextPath = currentPath.split(path.delimiter).includes(nodeBinDir)
    ? currentPath
    : [nodeBinDir, currentPath].filter(Boolean).join(path.delimiter);
  return {
    ...env,
    PATH: nextPath,
  };
}

export async function runServiceLaunchAudit(options = {}) {
  const plan = buildServiceLaunchPlan(options);
  const results = [];
  const envOverrides = options.envOverrides ?? {};
  const stepRunner = options.stepRunner ?? ((step) => runStep(step, { envOverrides }));
  const strictEvidenceOptions = {
    ...options,
    requireEvidenceReport: options.requireEvidenceReport ?? true,
    requireEvidenceChecklist: options.requireEvidenceChecklist ?? true,
    reportPath: options.reportPath ?? options.outputPath,
  };
  for (const step of plan.steps) {
    const failedPrerequisites = (step.requires_pass ?? []).filter((stepId) => (
      results.find((result) => result.id === stepId)?.status !== "pass"
    ));
    if (failedPrerequisites.length > 0) {
      const skippedAt = new Date();
      results.push(stepEvidence(step, skippedAt, {
        code: null,
        signal: null,
        status: "skipped",
        skipped_reason: "failed_prerequisite",
        failed_prerequisites: failedPrerequisites,
      }));
      if (!options.continueOnFailure) break;
      continue;
    }
    const result = await executeStep(step, stepRunner);
    results.push(result);
    if (result.status !== "pass" && !options.continueOnFailure) break;
  }
  const failed = results.filter((result) => result.status === "fail");
  const skipped = results.filter((result) => result.status === "skipped");
  const summary = {
    passed: results.filter((result) => result.status === "pass").length,
    failed: failed.length,
    skipped: skipped.length,
  };
  const status = failed.length === 0 && skipped.length === 0 && results.length === plan.steps.length ? "pass" : "fail";
  const report = {
    generated_at: new Date().toISOString(),
    status,
    summary,
    plan,
    env_input: envInputSummary(envOverrides, options),
    results,
    action_plan: buildServiceLaunchActionPlan(results, plan, strictEvidenceOptions),
    evidence_checklist: buildServiceLaunchEvidenceChecklist(plan, {
      ...strictEvidenceOptions,
      results,
    }),
  };
  return {
    ...report,
    launch_decision: buildServiceLaunchDecision(report, strictEvidenceOptions),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envOverrides = await loadAuditEnvOverrides(args);
  const auditArgs = {
    ...args,
    envOverrides,
  };
  const plan = buildServiceLaunchPlan(auditArgs);
  if (args.dryRun) {
    const output = {
      generated_at: new Date().toISOString(),
      mode: "dry-run",
      env_input: envInputSummary(envOverrides, args),
      rerun_command: redactedAuditRerunCommand(plan, args),
      env_checklist: buildServiceLaunchEnvChecklist(plan, auditArgs),
      ...plan,
    };
    if (args.outputPath || args.outputDir) {
      output.report_path = args.outputPath ?? defaultReportPath(output, args.outputDir);
    }
    output.evidence_checklist = buildServiceLaunchEvidenceChecklist(plan, {
      ...auditArgs,
      mode: "dry-run",
      reportPath: output.report_path,
    });
    output.launch_decision = buildServiceLaunchDecision(output, auditArgs);
    if (output.report_path) {
      output.report_path = await writeServiceLaunchReport(output, {
        outputPath: output.report_path,
        redactionEnv: childProcessEnv(envOverrides),
      });
    }
    console.log(JSON.stringify(redactSensitiveReportValue(output, childProcessEnv(envOverrides)), null, 2));
    return;
  }
  const output = await runServiceLaunchAudit(auditArgs);
  if (args.outputPath || args.outputDir) {
    output.report_path = args.outputPath ?? defaultReportPath(output, args.outputDir);
  }
  const finalAuditArgs = {
    ...auditArgs,
    requireEvidenceReport: true,
    requireEvidenceChecklist: true,
    reportPath: output.report_path,
  };
  output.action_plan = buildServiceLaunchActionPlan(output.results, output.plan, finalAuditArgs);
  output.evidence_checklist = buildServiceLaunchEvidenceChecklist(output.plan, {
    ...finalAuditArgs,
    results: output.results,
  });
  output.launch_decision = buildServiceLaunchDecision(output, finalAuditArgs);
  if (output.report_path) {
    output.report_path = await writeServiceLaunchReport(output, {
      outputPath: output.report_path,
      redactionEnv: childProcessEnv(envOverrides),
    });
  }
  console.log(JSON.stringify(redactSensitiveReportValue(output, childProcessEnv(envOverrides)), null, 2));
  process.exitCode = serviceLaunchAuditExitCode(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Service launch audit failed.");
    console.error(err);
    process.exit(1);
  });
}
