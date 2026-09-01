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

export function dealPriceLookup(deals: DealPriceRow[]): (alert: StoredPriceAlert) => DealPriceMatch {
  const byCode = new Map(deals.map((deal) => [deal.destination_code, deal]));
  return (alert) => {
    const deal = byCode.get(alert.destinationCode) ?? null;
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
export function offersHrefForAlert(alert: StoredPriceAlert, deal: DealPriceRow | null): string {
  const params = new URLSearchParams({ origin: alert.origin, destination: alert.destinationCode });
  if (deal?.economy_best_depart_date && deal?.economy_best_return_date) {
    params.set("depart", deal.economy_best_depart_date);
    params.set("return", deal.economy_best_return_date);
  }
  return `/offers?${params.toString()}`;
}
