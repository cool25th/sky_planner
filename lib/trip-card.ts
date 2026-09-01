import { formatCompactDate, formatMoney } from "./format.ts";
import type { CabinCode, StayBucket } from "./mock-market.ts";
import { PRICE_DEFINITION_SHORT } from "./price-definition.ts";
import { stayIncludesWeekend } from "./recommendation.ts";
import { holidayReason, holidaysInStay } from "./season-calendar.ts";
import { href } from "./url.ts";

export type TripCardVariant = "grid" | "strip" | "compact";
export type TripCardBadgeTone = "emphasis" | "neutral";

export interface TripCardDeal {
  destination_code: string;
  city: string;
  country: string;
  region_label: string;
  economy_min_total: number | null;
  business_min_total: number | null;
  economy_discount_pct: number | null;
  business_discount_pct: number | null;
  economy_best_depart_date?: string | null;
  economy_best_return_date?: string | null;
  best_origin_by_cabin: { ECONOMY: string | null; BUSINESS: string | null };
}

export interface TripCardBadge {
  id: string;
  label: string;
  tone: TripCardBadgeTone;
}

export interface TripCardQuery {
  origin: string;
  week: string;
  stay_bucket: StayBucket;
  traveler?: string;
  cabin?: CabinCode;
  budget?: number | null;
  // 지도 패널처럼 필터가 걸린 조회에서는 링크가 필터를 유지해야 한다.
  region?: string;
  airlines?: string[];
}

export interface TripCardModel {
  destinationCode: string;
  regionLabel: string;
  city: string;
  country: string;
  dateLine: string;
  priceLabel: string;
  priceAvailable: boolean;
  definition: string;
  originHint: string | null;
  badges: TripCardBadge[];
  reasons: string[];
  href: string;
  ariaLabel: string;
  bookmarkDeal: Pick<
    TripCardDeal,
    | "destination_code"
    | "city"
    | "country"
    | "economy_min_total"
    | "business_min_total"
  >;
}

const DAY_MS = 86400000;

function nightsBetween(depart?: string | null, ret?: string | null): number | null {
  if (!depart || !ret) return null;
  const start = Date.parse(`${depart.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${ret.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / DAY_MS);
}

function stayFallbackLabel(stay: StayBucket): string {
  if (stay === "3_4") return "3–4일 일정 최저";
  if (stay === "8_14") return "8–14일 일정 최저";
  return "5–7일 일정 최저";
}

export function buildDateLine(deal: TripCardDeal, stayBucket: StayBucket): string {
  const depart = deal.economy_best_depart_date;
  const ret = deal.economy_best_return_date;
  if (depart && ret) {
    const nights = nightsBetween(depart, ret);
    const nightsPart = nights ? ` · ${nights}박` : "";
    return `${formatCompactDate(depart)} → ${formatCompactDate(ret)}${nightsPart}`;
  }
  return `이 주간 · ${stayFallbackLabel(stayBucket)}`;
}

export function buildTripBadges(deal: TripCardDeal, cabin: CabinCode = "ALL"): TripCardBadge[] {
  const pct = cabin === "BUSINESS" ? deal.business_discount_pct : deal.economy_discount_pct;
  const badges: TripCardBadge[] = [];

  if (pct != null && pct >= 15) {
    badges.push({ id: "hot", label: "특가", tone: "emphasis" });
  } else if (pct != null && pct >= 5) {
    badges.push({ id: "value", label: "알뜰", tone: "neutral" });
  }

  if (stayIncludesWeekend(deal.economy_best_depart_date, deal.economy_best_return_date)) {
    badges.push({ id: "weekend", label: "주말", tone: "neutral" });
  }

  const holiday = holidayReason(
    holidaysInStay(deal.economy_best_depart_date, deal.economy_best_return_date),
  );
  if (holiday) {
    badges.push({ id: "holiday", label: "연휴", tone: "neutral" });
  }

  return badges.slice(0, 3);
}

function minTotal(deal: TripCardDeal, cabin: CabinCode): number | null {
  return cabin === "BUSINESS" ? deal.business_min_total : deal.economy_min_total;
}

function originHint(deal: TripCardDeal, origin: string, cabin: CabinCode): string | null {
  if (origin !== "SEL") return null;
  const code =
    cabin === "BUSINESS" ? deal.best_origin_by_cabin.BUSINESS : deal.best_origin_by_cabin.ECONOMY;
  if (code === "GMP") return "김포 출발 최저";
  if (code === "ICN") return "인천 출발 최저";
  return null;
}

export function toTripCardModel(
  deal: TripCardDeal,
  query: TripCardQuery,
  reasons: string[] = [],
): TripCardModel {
  const cabin = query.cabin ?? "ALL";
  const price = minTotal(deal, cabin);
  const dateLine = buildDateLine(deal, query.stay_bucket);
  const destHref = href(`/destination/${deal.destination_code}`, {
    origin: query.origin,
    week: query.week,
    stay_bucket: query.stay_bucket,
    traveler: query.traveler ?? "adt1",
    cabin,
    budget: query.budget ?? undefined,
    region: query.region,
    airlines: query.airlines?.length ? query.airlines.join(",") : undefined,
  });

  return {
    destinationCode: deal.destination_code,
    regionLabel: deal.region_label,
    city: deal.city,
    country: deal.country,
    dateLine,
    priceLabel: formatMoney(price),
    priceAvailable: price != null,
    definition: PRICE_DEFINITION_SHORT,
    originHint: originHint(deal, query.origin, cabin),
    badges: buildTripBadges(deal, cabin),
    reasons,
    href: destHref,
    ariaLabel: `${deal.city} 왕복 ${formatMoney(price)}, ${dateLine}`,
    bookmarkDeal: {
      destination_code: deal.destination_code,
      city: deal.city,
      country: deal.country,
      economy_min_total: deal.economy_min_total,
      business_min_total: deal.business_min_total,
    },
  };
}

// P0-commerce 2단계: 홈 최저가 스트립 — economy 가격이 확인된 딜만 오름차순, 상한.
// 큐레이션 그리드(점수순)와 달리 순수 가격 순서가 계약이다.
// deals_current는 목적지별 1행(mergeMapDeals 계약)이라 중복 제거는 별도로 하지 않는다.
export function selectLowestPriceDeals<T extends TripCardDeal>(deals: T[], limit = 8): T[] {
  return deals
    .filter((deal) => deal.economy_min_total != null)
    .sort((left, right) => (left.economy_min_total ?? 0) - (right.economy_min_total ?? 0))
    .slice(0, limit);
}
