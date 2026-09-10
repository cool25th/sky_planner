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
  {
    source_id: "travelpayouts_aviasales",
    env_flag: "SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED",
    default_enabled: true,
    booking_source_keys: ["travelpayouts", "aviasales"],
  },
];

export const DEFAULT_ENABLED_SOURCE_FLAGS = SOURCE_POLICY_CATALOG
  .filter((source) => source.default_enabled)
  .map((source) => source.source_id);

type EnvLike = Record<string, string | undefined>;
// DATA-20260828-001 완화(2026-09-01 승인): GitHub 스케줄 지연(관측 최대 8h15m)이 24h 마감을 넘기면
// 살아 있는 실운임을 버리고 목 데이터로 갈아끼우던 것을 "스테일 라이브"로 바꾼다 — 48h는 하루 종일
// 드랍이 아니면 넘지 않는 여유. 정직성 장치는 기존 것을 그대로 사용한다(스탬프에 실제 배치 시각 표시·
// 오퍼 CTA 28h 후 "가격 갱신 대기 중"·오퍼 72h 후 숨김·배너 "일 1회 수집 참고 운임").
// 운영은 SOURCE_MAX_STALE_HOURS env가 우선한다(프로덕션 값 갱신 필요 — 24 → 48).
const DEFAULT_SOURCE_MAX_STALE_HOURS = 48;

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

// UX-20260910-006: 가시 창 자동화 — env 고정값(프로덕션 24h) 대신 "직전 관측 + 안전 버퍼"를
// 커버하는 동적 창. 24h 마감을 넘긴 지연 도착 배치(25h/49h 시나리오)가 살아 있는 인벤토리를
// 0으로 만들지 않는다(불변식). env는 정상 시 창 상한으로만 사용하고, 커버리지 불변식이 절대
// 우선한다 — 현재 데이터를 차단하는 상한은 상한이 아니라 차단이기 때문. 절대 상한 14일은
// 장기 전멸에서 무기한 노출을 막는 정직성 마지노트(스탬프·CTA 규칙은 기존 그대로).
export const STALE_SAFETY_BUFFER_HOURS = 6;
export const STALE_HARD_CAP_HOURS = 14 * 24;

export function effectiveMaxStaleHours(
  input: { lastObservedAt: Date | string | null | undefined; now?: Date; baseHours?: number },
): number {
  const base = input.baseHours ?? DEFAULT_SOURCE_MAX_STALE_HOURS;
  const nowMs = (input.now ?? new Date()).getTime();
  const observedMs = timestampMs(input.lastObservedAt);
  const coverageHours = observedMs === null
    ? base
    : (nowMs - observedMs) / 3_600_000 + STALE_SAFETY_BUFFER_HOURS;
  return Math.min(Math.max(base, coverageHours), STALE_HARD_CAP_HOURS);
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
  // 동적 가시 창: 이 소스의 직전 관측 + 버퍼를 커버(지연 도착 배치 잔존 보장) — 14일 절대 상한.
  const staleAfterMs = effectiveMaxStaleHours({ lastObservedAt: new Date(lastSuccessMs), now, baseHours: maxStaleHours }) * 3_600_000;
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
