import {
  AIRLINES,
  DEFAULT_STAY_BUCKET,
  TRIP_BUCKETS,
  type MapQuery,
  getMetaData,
} from "@/lib/mock-market";

export const AIRLINE_NAME_BY_CODE = new Map(AIRLINES.map((airline) => [airline.code, airline.name]));
export const AIRLINE_BY_CODE = new Map(AIRLINES.map((airline) => [airline.code, airline]));
export const TRIP_BUCKET_LABEL_BY_CODE = new Map(TRIP_BUCKETS.map((bucket) => [bucket.code, bucket.label]));
const REGION_LABEL_BY_CODE = new Map(getMetaData().regions.map((region) => [region.code, region.label]));
const regionNames = new Intl.DisplayNames(["ko"], { type: "region" });

export function normalizeRegion(region?: string) {
  return (region?.toUpperCase() ?? "ALL") as MapQuery["region"];
}

export function queryOrigins(origin: string): string[] {
  // SEL(서울 메트로 코드)은 Aviasales 계열 응답의 origin 정규화 값 — ICN 조회에서 유효한 서울 출발 별칭으로 취급한다.
  return origin === "SEL" ? ["ICN", "GMP", "SEL"] : [origin];
}

export function regionLabel(region?: string) {
  const normalized = normalizeRegion(region);
  return REGION_LABEL_BY_CODE.get(normalized) ?? String(region ?? "");
}

export function countryLabel(countryCode?: string) {
  if (!countryCode) return "";
  const normalized = countryCode.toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) {
    return regionNames.of(normalized) ?? normalized;
  }
  return normalized;
}

export function normalizeCabin(cabin?: string) {
  const normalized = cabin?.toUpperCase();
  if (normalized === "ECONOMY" || normalized === "BUSINESS") return normalized;
  return "ALL" as const;
}

export function normalizeStayBucket(stayBucket?: string) {
  const normalized = stayBucket?.replace("-", "_");
  if (normalized === "3_4" || normalized === "5_7" || normalized === "8_14") return normalized;
  return DEFAULT_STAY_BUCKET;
}

export function normalizePriceStatus(value?: string | null): "active" | "stale" | "sold_out" | null {
  if (value === "stale" || value === "sold_out" || value === "active") return value;
  return null;
}
