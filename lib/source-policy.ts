export interface SourcePolicy {
  source_id: string;
  env_flag: string;
  default_enabled: boolean;
  booking_source_keys: string[];
}

export interface SourceHealthStatus {
  source_id?: string;
  is_paused?: boolean | null;
  enabled_by_flag?: boolean | null;
  circuit_breaker_open?: boolean | null;
  consecutive_failures?: number | string | null;
  last_success_at?: Date | string | null;
}

export const SOURCE_POLICY_CATALOG: SourcePolicy[] = [
  {
    source_id: "skyscanner_affiliate",
    env_flag: "SOURCE_SKYSCANNER_ENABLED",
    default_enabled: true,
    booking_source_keys: ["skyscanner_affiliate", "skyscanner"],
  },
  {
    source_id: "korean_air_official",
    env_flag: "SOURCE_KOREAN_AIR_ENABLED",
    default_enabled: true,
    booking_source_keys: ["korean_air_official", "ke", "korean air", "대한항공"],
  },
  {
    source_id: "asiana_official",
    env_flag: "SOURCE_ASIANA_ENABLED",
    default_enabled: true,
    booking_source_keys: ["asiana_official", "oz", "asiana", "아시아나항공"],
  },
  {
    source_id: "google_flights_direct",
    env_flag: "SOURCE_GOOGLE_FLIGHTS_ENABLED",
    default_enabled: false,
    booking_source_keys: ["google_flights_direct", "google flights"],
  },
  {
    source_id: "kayak_direct",
    env_flag: "SOURCE_KAYAK_ENABLED",
    default_enabled: false,
    booking_source_keys: ["kayak_direct", "kayak"],
  },
  {
    source_id: "official_promo_pages",
    env_flag: "SOURCE_PROMO_PAGES_ENABLED",
    default_enabled: false,
    booking_source_keys: ["official_promo_pages", "official_promo", "promo_page", "공식 특가"],
  },
];

export const DEFAULT_ENABLED_SOURCE_FLAGS = SOURCE_POLICY_CATALOG
  .filter((source) => source.default_enabled)
  .map((source) => source.source_id);

type EnvLike = Record<string, string | undefined>;
const DEFAULT_SOURCE_MAX_STALE_HOURS = 24;

function envFlagEnabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

export function enabledSourceFlagsFromEnv(env: EnvLike = process.env) {
  return SOURCE_POLICY_CATALOG
    .filter((source) => envFlagEnabled(env[source.env_flag], source.default_enabled))
    .map((source) => source.source_id);
}

export function sourceMaxStaleHoursFromEnv(env: EnvLike = process.env) {
  const value = Number(env.SOURCE_MAX_STALE_HOURS ?? "");
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SOURCE_MAX_STALE_HOURS;
  return value;
}

function timestampMs(value: Date | string | null | undefined) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function sourceHealthBlockReason(
  health: SourceHealthStatus | undefined,
  now = new Date(),
  maxStaleHours = DEFAULT_SOURCE_MAX_STALE_HOURS,
) {
  if (!health) return "missing_source_health";
  if (health.is_paused) return "paused";
  if (health.enabled_by_flag === false) return "disabled_by_health";
  if (health.circuit_breaker_open) return "circuit_breaker_open";
  if (Number(health.consecutive_failures ?? 0) >= 3) return "consecutive_failures";

  const lastSuccessMs = timestampMs(health.last_success_at);
  if (lastSuccessMs === null) return "never_successful";
  const staleAfterMs = maxStaleHours * 60 * 60 * 1000;
  if (now.getTime() - lastSuccessMs > staleAfterMs) return "stale";
  return null;
}

export function filterHealthySourceFlags(
  sourceFlags: string[],
  healthRows: SourceHealthStatus[],
  now = new Date(),
  maxStaleHours = DEFAULT_SOURCE_MAX_STALE_HOURS,
) {
  const healthBySource = new Map(healthRows.map((row) => [String(row.source_id ?? ""), row]));
  return sourceFlags.filter((sourceId) => !sourceHealthBlockReason(healthBySource.get(sourceId), now, maxStaleHours));
}

export function eligibleBookingSourceKeys(sourceFlags: string[]) {
  const selected = new Set(sourceFlags);
  return new Set(
    SOURCE_POLICY_CATALOG
      .filter((source) => selected.has(source.source_id))
      .flatMap((source) => [source.source_id, ...source.booking_source_keys])
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function sourceIdForBookingSourceKey(rawKey: string | null | undefined) {
  const key = rawKey?.trim().toLowerCase();
  if (!key) return null;
  return SOURCE_POLICY_CATALOG.find((source) => {
    const aliases = [source.source_id, ...source.booking_source_keys].map((value) => value.trim().toLowerCase());
    return aliases.includes(key);
  })?.source_id ?? null;
}

export function isOfferSourceEligible(
  offer: { source_id?: string; source_name?: string; airline_code?: string; source_type?: string },
  sourceFlags: string[],
) {
  const eligible = eligibleBookingSourceKeys(sourceFlags);
  if (!eligible.size) return false;
  const sourceKeys = [offer.source_id, offer.source_name];
  if (offer.source_type !== "meta_search") {
    sourceKeys.push(offer.airline_code);
  }
  return sourceKeys
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .some((value) => eligible.has(value));
}
