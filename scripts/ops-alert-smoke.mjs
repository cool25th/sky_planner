import { pathToFileURL } from "node:url";

const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org", "example.test"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const SENSITIVE_KEY_PATTERN = /secret|token|password|credential|api[_-]?key|database[_-]?url|webhook/i;

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

export function validateOpsAlertWebhookUrl(rawUrl) {
  if (!rawUrl) return { ok: false, reason: "missing" };
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return { ok: false, reason: "not_https", protocol: url.protocol, host };
  if (LOCAL_HOSTS.has(host)) return { ok: false, reason: "local_host", host };
  if (isPlaceholderHost(host)) return { ok: false, reason: "placeholder_host", host };
  return { ok: true, host };
}

function redactSensitiveString(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

export function sanitizeOpsAlertPayload(value, key = "") {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    if (Array.isArray(value)) return value.map(() => "[REDACTED]");
    if (typeof value === "object") return "[REDACTED]";
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactSensitiveString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeOpsAlertPayload(item, key));
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeOpsAlertPayload(entryValue, entryKey),
  ]));
}

export async function sendOpsAlert(payload, options = {}) {
  const webhookUrl = options.webhookUrl ?? process.env.OPS_ALERT_WEBHOOK_URL;
  const validation = validateOpsAlertWebhookUrl(webhookUrl);
  if (!validation.ok) {
    return { sent: false, validation };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = {
    service: "sky_planner",
    environment: options.environment ?? process.env.NODE_ENV ?? "unknown",
    generated_at: options.generatedAt ?? new Date().toISOString(),
    ...sanitizeOpsAlertPayload(payload),
  };
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      sent: response.ok,
      status: response.status,
      validation,
    };
  } catch (err) {
    return {
      sent: false,
      validation,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseArgs(argv) {
  const args = {
    event: "ops_alert_smoke",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event") {
      args.event = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.event) throw new Error("--event must not be empty");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dryRun) {
    const validation = validateOpsAlertWebhookUrl(process.env.OPS_ALERT_WEBHOOK_URL);
    const output = { sent: false, dry_run: true, validation };
    console.log(JSON.stringify(output, null, 2));
    if (!validation.ok) process.exitCode = 1;
    return;
  }

  const output = await sendOpsAlert({
    event: args.event,
    status: "test",
    message: "Sky Planner ops alert delivery smoke",
  });
  console.log(JSON.stringify(output, null, 2));
  if (!output.sent) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Ops alert smoke failed.");
    console.error(err);
    process.exit(1);
  });
}
