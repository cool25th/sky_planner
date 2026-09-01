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
}

export interface AlertEvaluation {
  alert: StoredPriceAlert;
  currentPrice: number | null;
  reached: boolean;
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

export function dealPriceLookup(deals: DealPriceRow[]): (alert: StoredPriceAlert) => number | null {
  const byCode = new Map(deals.map((deal) => [deal.destination_code, deal]));
  return (alert) => {
    const deal = byCode.get(alert.destinationCode);
    if (!deal) return null;
    const price = alert.cabin === "BUSINESS" ? deal.business_min_total : deal.economy_min_total;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  };
}

export function evaluatePriceAlerts(
  alerts: StoredPriceAlert[],
  priceFor: (alert: StoredPriceAlert) => number | null,
): { reached: AlertEvaluation[]; pending: AlertEvaluation[] } {
  const evaluations = alerts.map((alert) => {
    const currentPrice = priceFor(alert);
    return { alert, currentPrice, reached: currentPrice !== null && currentPrice <= alert.targetPrice };
  });
  return {
    reached: evaluations.filter((item) => item.reached),
    pending: evaluations.filter((item) => !item.reached),
  };
}
