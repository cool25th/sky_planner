const TRUE_VALUES = new Set(["1", "true", "yes", "on", "required"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export const SERVICE_REQUIRE_POSTGRES_ENV = "SERVICE_REQUIRE_POSTGRES";

export function serviceRequiresPostgres(env: Record<string, string | undefined> = process.env) {
  return TRUE_VALUES.has(String(env[SERVICE_REQUIRE_POSTGRES_ENV] ?? "").trim().toLowerCase());
}

export function serviceRequirePostgresFailure(env: Record<string, string | undefined> = process.env) {
  const raw = env[SERVICE_REQUIRE_POSTGRES_ENV];
  if (!raw) return "missing";
  const normalized = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return null;
  if (FALSE_VALUES.has(normalized)) return "disabled";
  return "invalid";
}
