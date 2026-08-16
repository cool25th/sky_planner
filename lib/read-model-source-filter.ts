import type {
  CalendarCell,
  CalendarData,
  CalendarQuery,
  MapDeal,
  Offer,
} from "./mock-market.ts";
import { eligibleBookingSourceKeys } from "./source-policy.ts";

export interface MapDealSourceInfo {
  economy_representative_source?: string | null;
  business_representative_source?: string | null;
}

export type CalendarDestinationLike = NonNullable<CalendarData["destination"]>;
type CalendarCellDraft = Omit<CalendarCell, "badges"> & { badges: Set<string> };

function normalizedSourceKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function eligibleReadModelSourceKeys(sourceFlags: string[]) {
  return new Set(eligibleBookingSourceKeys(sourceFlags));
}

export function readModelSourceKeyIsEligible(
  value: string | null | undefined,
  eligibleSourceKeys: Set<string>,
) {
  const normalized = normalizedSourceKey(value);
  return Boolean(normalized) && eligibleSourceKeys.has(normalized);
}

function clearEconomy(deal: MapDeal) {
  deal.economy_min_total = null;
  deal.economy_discount_pct = null;
  deal.economy_price_status = null;
  deal.best_airline_by_cabin.ECONOMY = null;
  deal.representative_links.ECONOMY = null;
}

function clearBusiness(deal: MapDeal) {
  deal.business_min_total = null;
  deal.business_discount_pct = null;
  deal.business_price_status = null;
  deal.best_airline_by_cabin.BUSINESS = null;
  deal.representative_links.BUSINESS = null;
}

export function filterMapDealForSourceFlags(
  deal: MapDeal,
  sourceInfo: MapDealSourceInfo,
  sourceFlags: string[],
) {
  const eligibleSourceKeys = eligibleReadModelSourceKeys(sourceFlags);
  if (!eligibleSourceKeys.size) return null;

  const economyVisible =
    deal.economy_min_total === null ||
    readModelSourceKeyIsEligible(sourceInfo.economy_representative_source, eligibleSourceKeys);
  const businessVisible =
    deal.business_min_total === null ||
    readModelSourceKeyIsEligible(sourceInfo.business_representative_source, eligibleSourceKeys);

  const next: MapDeal = {
    ...deal,
    best_airline_by_cabin: { ...deal.best_airline_by_cabin },
    representative_links: { ...deal.representative_links },
    source_mix: deal.source_mix.filter((source) => readModelSourceKeyIsEligible(source, eligibleSourceKeys)),
  };

  if (!economyVisible) clearEconomy(next);
  if (!businessVisible) clearBusiness(next);

  const visibleRepresentativeSources = [
    next.economy_min_total === null ? null : sourceInfo.economy_representative_source,
    next.business_min_total === null ? null : sourceInfo.business_representative_source,
  ].filter((source): source is string => readModelSourceKeyIsEligible(source, eligibleSourceKeys));
  next.source_mix = [...new Set([...next.source_mix, ...visibleRepresentativeSources])].sort();

  return next.economy_min_total === null && next.business_min_total === null ? null : next;
}

export function mapDealMatchesCabin(deal: MapDeal, cabin: "ALL" | "ECONOMY" | "BUSINESS") {
  if (cabin === "ECONOMY") return deal.economy_min_total !== null;
  if (cabin === "BUSINESS") return deal.business_min_total !== null;
  return deal.economy_min_total !== null || deal.business_min_total !== null;
}

export function buildCalendarDataFromOffers(
  query: CalendarQuery,
  destination: CalendarDestinationLike | null,
  offers: Offer[],
): CalendarData {
  if (!destination) {
    return {
      origin: query.origin,
      week: query.week,
      stay_bucket: query.stay_bucket,
      traveler: query.traveler,
      destination: null,
      departure_dates: [],
      return_dates: [],
      cells: [],
      available_airlines: [],
    };
  }

  const cells = new Map<string, CalendarCellDraft>();
  const departureDates = new Set<string>();
  const returnDates = new Set<string>();

  for (const offer of offers) {
    const key = `${offer.depart_date}:${offer.return_date}`;
    const current = cells.get(key) ?? {
      depart_date: offer.depart_date,
      return_date: offer.return_date,
      stay_nights: offer.stay_nights,
      trip_bucket: offer.trip_bucket_label,
      economy_min_total: null,
      business_min_total: null,
      economy_discount_pct: null,
      business_discount_pct: null,
      economy_price_status: null,
      business_price_status: null,
      best_airline_by_cabin: { ECONOMY: null, BUSINESS: null },
      best_offer_ids: { ECONOMY: null, BUSINESS: null },
      last_batch_at: offer.last_batch_at,
      badges: new Set<string>(),
    };

    if (offer.cabin_group === "ECONOMY" && (current.economy_min_total === null || offer.price_total < current.economy_min_total)) {
      current.economy_min_total = offer.price_total;
      current.economy_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.economy_price_status = offer.price_status;
      current.best_airline_by_cabin.ECONOMY = offer.airline_code;
      current.best_offer_ids.ECONOMY = offer.offer_id;
      current.last_batch_at = offer.last_batch_at;
    }

    if (offer.cabin_group === "BUSINESS" && (current.business_min_total === null || offer.price_total < current.business_min_total)) {
      current.business_min_total = offer.price_total;
      current.business_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.business_price_status = offer.price_status;
      current.best_airline_by_cabin.BUSINESS = offer.airline_code;
      current.best_offer_ids.BUSINESS = offer.offer_id;
      current.last_batch_at = offer.last_batch_at;
    }

    for (const badge of offer.badges) current.badges.add(badge);
    departureDates.add(offer.depart_date);
    returnDates.add(offer.return_date);
    cells.set(key, current);
  }

  const serializedCells: CalendarCell[] = [...cells.values()]
    .map((cell) => ({
      ...cell,
      badges: [...cell.badges].sort(),
    }))
    .sort((left, right) => left.depart_date.localeCompare(right.depart_date) || left.return_date.localeCompare(right.return_date));

  return {
    origin: query.origin,
    week: query.week,
    stay_bucket: query.stay_bucket,
    traveler: query.traveler,
    destination,
    departure_dates: [...departureDates].sort(),
    return_dates: [...returnDates].sort(),
    cells: serializedCells,
    available_airlines: [...new Map(offers.map((offer) => [
      offer.airline_code,
      { code: offer.airline_code, name: offer.airline_name },
    ])).values()],
  };
}
