export type FareFreshnessLevel = "fresh" | "delayed" | "cta_disabled" | "hidden";

export interface FareFreshness {
  level: FareFreshnessLevel;
  ageHours: number;
}

// 권장 운영 정책 기준값. 데이터 공급자 계약에 별도 유효기간이 있으면 계약 기준을 우선한다.
const DELAYED_AFTER_HOURS = 24;
const CTA_DISABLED_AFTER_HOURS = 28;
const HIDDEN_AFTER_HOURS = 72;
const HOUR_MS = 3_600_000;

function parseSeenAt(value: string) {
  // last_seen_at 문자열은 타임존 마커 없는 UTC 벽시각이다(ISO slice).
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  return new Date(`${value}Z`);
}

export function fareFreshness(lastSeenAt: string, now: Date = new Date()): FareFreshness {
  const seen = parseSeenAt(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return { level: "hidden", ageHours: Number.POSITIVE_INFINITY };
  const ageHours = (now.getTime() - seen.getTime()) / HOUR_MS;
  if (ageHours >= HIDDEN_AFTER_HOURS) return { level: "hidden", ageHours };
  if (ageHours >= CTA_DISABLED_AFTER_HOURS) return { level: "cta_disabled", ageHours };
  if (ageHours >= DELAYED_AFTER_HOURS) return { level: "delayed", ageHours };
  return { level: "fresh", ageHours };
}

export function isHiddenFare(lastSeenAt: string, now?: Date) {
  return fareFreshness(lastSeenAt, now).level === "hidden";
}
