export interface SupportContactResult {
  ok: boolean;
  env_name?: "SUPPORT_EMAIL" | "NEXT_PUBLIC_SUPPORT_EMAIL";
  email?: string;
  host?: string;
  reason?: "missing" | "invalid_email" | "placeholder_email_host";
}

type EnvLike = Record<string, string | undefined>;

const PLACEHOLDER_HOSTS = new Set(["example.com", "example.net", "example.org", "example.test"]);

function isPlaceholderHost(host: string) {
  return (
    PLACEHOLDER_HOSTS.has(host) ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.net") ||
    host.endsWith(".example.org") ||
    host.endsWith(".example") ||
    host.endsWith(".test")
  );
}

export function resolveSupportContact(env: EnvLike = process.env): SupportContactResult {
  const envName = env.SUPPORT_EMAIL ? "SUPPORT_EMAIL" : env.NEXT_PUBLIC_SUPPORT_EMAIL ? "NEXT_PUBLIC_SUPPORT_EMAIL" : undefined;
  const email = envName ? String(env[envName]).trim() : "";
  if (!envName || !email) {
    return { ok: false, reason: "missing" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email", env_name: envName };
  }
  const host = email.split("@").pop()?.toLowerCase() ?? "";
  if (isPlaceholderHost(host)) {
    return { ok: false, reason: "placeholder_email_host", env_name: envName, host };
  }
  return { ok: true, env_name: envName, email, host };
}
