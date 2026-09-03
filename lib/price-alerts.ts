// UX-20260831-006 MVP(재방문 비교): 가격 알림은 아직 발송 인프라가 없어 localStorage 기록뿐이다.
// 이 모듈은 저장된 알림과 현재 최저가를 비교하는 순수 로직만 담는다 — 발송(A3)은 별도 계층.

export interface StoredPriceAlert {
  id: string;
  destinationCode: string;
  cityName: string;
  origin: string;
  targetPrice: number;
  cabin?: string;
  email?: string;
  createdAt?: number;
}

export interface DealPriceRow {
  destination_code: string;
  economy_min_total: number | null;
  business_min_total: number | null;
  // UX-20260902-001: 도달 알림의 "항공편 보기" 링크에 싣는 최저가 날짜 조합(map API 딜 필드).
  economy_best_depart_date?: string | null;
  economy_best_return_date?: string | null;
  business_best_depart_date?: string | null;
  business_best_return_date?: string | null;
  // UX-20260903-001: map API 딜의 최저가 출발지 — 다중 출발지 알림이 한 목록에 섞일 때 같은 목적지를 구분한다.
  best_origin_by_cabin?: { ECONOMY: string | null; BUSINESS: string | null };
}

export interface DealPriceMatch {
  price: number | null;
  deal: DealPriceRow | null;
}

export interface AlertEvaluation {
  alert: StoredPriceAlert;
  currentPrice: number | null;
  reached: boolean;
  deal: DealPriceRow | null;
}

const ALERTS_STORAGE_KEY = "sky_planner_price_alerts";

export function priceAlertsStorageKey(): string {
  return ALERTS_STORAGE_KEY;
}

function isValidAlert(value: unknown): value is StoredPriceAlert {
  if (typeof value !== "object" || value === null) return false;
  const alert = value as Record<string, unknown>;
  return (
    typeof alert.id === "string" &&
    typeof alert.destinationCode === "string" &&
    alert.destinationCode.length > 0 &&
    typeof alert.cityName === "string" &&
    typeof alert.origin === "string" &&
    alert.origin.length > 0 &&
    typeof alert.targetPrice === "number" &&
    Number.isFinite(alert.targetPrice) &&
    alert.targetPrice > 0
  );
}

export function parseStoredPriceAlerts(raw: string | null): StoredPriceAlert[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAlert);
  } catch {
    return [];
  }
}

// 서울 메트로 등가 — lib/read-model/labels.ts queryOrigins와 같은 규칙을 클라이언트 번들 격리를 위해 인라인했다.
// ponytail: 3코드 집합 복제. 메트로 정의가 바뀌면 labels.ts와 함께 여기도 갱신한다.
const METRO_EQUIVALENT_ORIGINS = new Set(["SEL", "ICN", "GMP"]);

function originsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.trim().toUpperCase();
  const y = b.trim().toUpperCase();
  return x === y || (METRO_EQUIVALENT_ORIGINS.has(x) && METRO_EQUIVALENT_ORIGINS.has(y));
}

function dealOrigins(deal: DealPriceRow): Array<string | null | undefined> {
  return [deal.best_origin_by_cabin?.ECONOMY, deal.best_origin_by_cabin?.BUSINESS];
}

export function dealPriceLookup(deals: DealPriceRow[]): (alert: StoredPriceAlert) => DealPriceMatch {
  // UX-20260903-001: 홈이 출발지별 map API 응답을 한 목록으로 합치므로 같은 목적지가 여러 출발지에서 온다.
  // 목적지만으로 인덱싱하면 마지막 출발지 가격이 모든 알림에 적용된다 — 알림 origin과 매칭해 고른다.
  const byCode = new Map<string, DealPriceRow[]>();
  for (const deal of deals) {
    byCode.set(deal.destination_code, [...(byCode.get(deal.destination_code) ?? []), deal]);
  }
  return (alert) => {
    const candidates = byCode.get(alert.destinationCode) ?? [];
    const deal = candidates.find((item) => dealOrigins(item).some((origin) => originsEquivalent(origin, alert.origin))) ?? candidates[0] ?? null;
    if (!deal) return { price: null, deal: null };
    const raw = alert.cabin === "BUSINESS" ? deal.business_min_total : deal.economy_min_total;
    const price = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return { price, deal };
  };
}

export function evaluatePriceAlerts(
  alerts: StoredPriceAlert[],
  lookup: (alert: StoredPriceAlert) => DealPriceMatch,
): { reached: AlertEvaluation[]; pending: AlertEvaluation[] } {
  const evaluations = alerts.map((alert) => {
    const { price, deal } = lookup(alert);
    return { alert, currentPrice: price, deal, reached: price !== null && price <= alert.targetPrice };
  });
  return {
    reached: evaluations.filter((item) => item.reached),
    pending: evaluations.filter((item) => !item.reached),
  };
}

// UX-20260902-001: /offers의 postgres 조회는 depart+return 필수다 — 없으면 데모 폴백으로 이어진다.
// 딜의 최저가 날짜를 붙여 도달 알림이 실제 live 오퍼 목록으로 연결되게 한다. 날짜 결측 시 기존 링크 유지(폴백).
// UX-20260903-002: 비즈니스 알림은 표시한 가격(비즈니스 최저가)과 같은 캐빈의 목록으로 연결한다 —
// 비즈니스 best 날짜가 없으면 이코노미 날짜에 cabin만 붙인다(빈 목록은 정직, 데모 폴백은 아님).
export function offersHrefForAlert(alert: StoredPriceAlert, deal: DealPriceRow | null): string {
  const params = new URLSearchParams({ origin: alert.origin, destination: alert.destinationCode });
  const business = alert.cabin === "BUSINESS";
  const depart = (business ? deal?.business_best_depart_date : undefined) ?? deal?.economy_best_depart_date;
  const ret = (business ? deal?.business_best_return_date : undefined) ?? deal?.economy_best_return_date;
  if (depart && ret) {
    params.set("depart", depart);
    params.set("return", ret);
  }
  if (business) params.set("cabin", "BUSINESS");
  return `/offers?${params.toString()}`;
}
