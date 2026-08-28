import { z } from "zod";

import {
  DEFAULT_STAY_BUCKET,
  DEFAULT_TRAVELER,
  type MapDeal,
  type MapQuery,
  type Offer,
  getMetaData,
} from "@/lib/mock-market";
import {
  AIRLINE_BY_CODE,
  AIRLINE_NAME_BY_CODE,
  TRIP_BUCKET_LABEL_BY_CODE,
  countryLabel,
  normalizeCabin,
  normalizePriceStatus,
  normalizeRegion,
  normalizeStayBucket,
  regionLabel,
} from "./labels";

// node-pg 타입 매핑: NUMERIC→string|null, TIMESTAMPTZ/DATE→Date|null, TEXT[]→string[]|null(DDL이 DEFAULT만 있고 NOT NULL 아님), FLOAT8→number|null
const numericLike = z.union([z.number(), z.string()]).nullable().optional();
const timestampLike = z.union([z.date(), z.string()]).nullable().optional();
const textLike = z.string().nullable().optional();
const textArray = z.array(z.string()).nullable().optional();

export const dealCurrentRowSchema = z.object({
  origin: textLike,
  destination_city_id: textLike,
  destination_display_name: textLike,
  country_code: textLike,
  region: textLike,
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  economy_min_total_krw: numericLike,
  economy_discount_pct: numericLike,
  economy_best_depart_date: z.union([z.string(), z.date()]).nullable().optional(),
  economy_best_return_date: z.union([z.string(), z.date()]).nullable().optional(),
  economy_badge_type: textLike,
  economy_price_status: textLike,
  economy_representative_airline: textLike,
  economy_representative_source: textLike,
  economy_deep_link: textLike,
  economy_last_seen_at: timestampLike,
  economy_last_batch_at: timestampLike,
  business_min_total_krw: numericLike,
  business_discount_pct: numericLike,
  business_badge_type: textLike,
  business_price_status: textLike,
  business_representative_airline: textLike,
  business_representative_source: textLike,
  business_deep_link: textLike,
  business_last_seen_at: timestampLike,
  business_last_batch_at: timestampLike,
  warning_flags: textArray,
  enabled_sources: textArray,
});

export type DealCurrentRow = z.infer<typeof dealCurrentRowSchema>;

export const offerJoinRowSchema = z.object({
  offer_id: textLike,
  origin_airport: textLike,
  destination_airport: textLike,
  destination_city_id: textLike,
  traveler: textLike,
  stay_bucket: textLike,
  depart_date: timestampLike,
  return_date: timestampLike,
  stay_nights: numericLike,
  airline_code: textLike,
  airline_name: textLike,
  booking_source: textLike,
  source_id: textLike,
  source_type: textLike,
  cabin_group: textLike,
  cabin_label_raw: textLike,
  fare_brand_raw: textLike,
  total_price: numericLike,
  normalized_total_krw: numericLike,
  average_30_total: numericLike,
  average_90_total: numericLike,
  discount_pct_30: numericLike,
  discount_pct_90: numericLike,
  price_status: textLike,
  is_price_changed: z.boolean().nullable().optional(),
  stop_count: numericLike,
  departure_time_local: textLike,
  arrival_time_local: textLike,
  return_departure_time_local: textLike,
  return_arrival_time_local: textLike,
  duration_minutes: numericLike,
  duration_hours: numericLike,
  deep_link: textLike,
  official_promotion: z.boolean().nullable().optional(),
  warning_flags: textArray,
  badges: textArray,
  last_seen_at: timestampLike,
  last_batch_at: timestampLike,
  dest_latitude: z.number().nullable().optional(),
  dest_longitude: z.number().nullable().optional(),
  dest_display_name_ko: textLike,
  dest_country_code: textLike,
  dest_region: textLike,
});

export type OfferJoinRow = z.infer<typeof offerJoinRowSchema>;

export function parseDealCurrentRow(row: unknown): DealCurrentRow {
  return dealCurrentRowSchema.parse(row);
}

export function parseOfferJoinRow(row: unknown): OfferJoinRow {
  return offerJoinRowSchema.parse(row);
}

function resolveTimestampStr(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 16);
  return String(value).slice(0, 16);
}

function resolveDateOnly(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

export function mapDealFromSql(row: DealCurrentRow, fallbackBatchAt: string): MapDeal {
  const lat = typeof row.latitude === "number" ? row.latitude : 37.5665;
  const lon = typeof row.longitude === "number" ? row.longitude : 126.978;

  const lastBatch =
    resolveTimestampStr(row.economy_last_batch_at) ||
    resolveTimestampStr(row.business_last_batch_at) ||
    fallbackBatchAt;

  const lastSeen =
    resolveTimestampStr(row.economy_last_seen_at) ||
    resolveTimestampStr(row.business_last_seen_at) ||
    fallbackBatchAt;

  const originCode = String(row.origin ?? "") || null;

  return {
    destination_code: String(row.destination_city_id ?? ""),
    city: String(row.destination_display_name ?? row.destination_city_id ?? ""),
    country: countryLabel(String(row.country_code ?? "")),
    region_code: normalizeRegion(String(row.region ?? "ALL")) as Exclude<MapQuery["region"], "ALL">,
    region_label: regionLabel(String(row.region ?? "")),
    lat,
    lon,
    economy_min_total: row.economy_min_total_krw !== null && row.economy_min_total_krw !== undefined ? Number(row.economy_min_total_krw) : null,
    business_min_total: row.business_min_total_krw !== null && row.business_min_total_krw !== undefined ? Number(row.business_min_total_krw) : null,
    economy_discount_pct: row.economy_discount_pct !== null && row.economy_discount_pct !== undefined ? Number(row.economy_discount_pct) : null,
    business_discount_pct: row.business_discount_pct !== null && row.business_discount_pct !== undefined ? Number(row.business_discount_pct) : null,
    economy_best_depart_date: resolveDateOnly(row.economy_best_depart_date) || null,
    economy_best_return_date: resolveDateOnly(row.economy_best_return_date) || null,
    economy_price_status: normalizePriceStatus(row.economy_price_status),
    business_price_status: normalizePriceStatus(row.business_price_status),
    best_airline_by_cabin: {
      ECONOMY: row.economy_representative_airline ?? null,
      BUSINESS: row.business_representative_airline ?? null,
    },
    best_origin_by_cabin: {
      ECONOMY: row.economy_min_total_krw != null ? originCode : null,
      BUSINESS: row.business_min_total_krw != null ? originCode : null,
    },
    representative_links: {
      ECONOMY: row.economy_deep_link ?? null,
      BUSINESS: row.business_deep_link ?? null,
    },
    last_batch_at: lastBatch,
    last_seen_at: lastSeen,
    warning_flags: Array.isArray(row.warning_flags) ? row.warning_flags : [],
    promotion_tags: [row.economy_badge_type, row.business_badge_type].filter((value): value is string => Boolean(value)),
    source_mix: Array.isArray(row.enabled_sources) ? row.enabled_sources : [],
  };
}

export function mergeMapDeals(deals: MapDeal[]): MapDeal {
  if (deals.length === 1) return deals[0];
  const cheapest = (deal: MapDeal, other: MapDeal, cabin: "economy_min_total" | "business_min_total") =>
    (deal[cabin] ?? Number.MAX_SAFE_INTEGER) <= (other[cabin] ?? Number.MAX_SAFE_INTEGER) ? deal : other;
  const eco = deals.reduce((acc, deal) => cheapest(acc, deal, "economy_min_total"));
  const biz = deals.reduce((acc, deal) => cheapest(acc, deal, "business_min_total"));
  const latestStamp = (key: "last_batch_at" | "last_seen_at") =>
    deals.reduce((latest, deal) => (deal[key] > latest ? deal[key] : latest), deals[0][key]);
  return {
    ...deals[0],
    economy_min_total: eco.economy_min_total,
    economy_discount_pct: eco.economy_discount_pct,
    economy_price_status: eco.economy_price_status,
    business_min_total: biz.business_min_total,
    business_discount_pct: biz.business_discount_pct,
    business_price_status: biz.business_price_status,
    best_airline_by_cabin: { ECONOMY: eco.best_airline_by_cabin.ECONOMY, BUSINESS: biz.best_airline_by_cabin.BUSINESS },
    best_origin_by_cabin: {
      ECONOMY: eco.economy_min_total != null ? eco.best_origin_by_cabin.ECONOMY : null,
      BUSINESS: biz.business_min_total != null ? biz.best_origin_by_cabin.BUSINESS : null,
    },
    representative_links: { ECONOMY: eco.representative_links.ECONOMY, BUSINESS: biz.representative_links.BUSINESS },
    last_batch_at: latestStamp("last_batch_at"),
    last_seen_at: latestStamp("last_seen_at"),
    warning_flags: [...new Set(deals.flatMap((deal) => deal.warning_flags))],
    promotion_tags: [...new Set(deals.flatMap((deal) => deal.promotion_tags))],
    source_mix: [...new Set(deals.flatMap((deal) => deal.source_mix))],
  };
}

export function mapOfferFromSql(row: OfferJoinRow, fallbackBatchAt: string): Offer {
  const lat = typeof row.dest_latitude === "number" ? row.dest_latitude : 37.5665;
  const lon = typeof row.dest_longitude === "number" ? row.dest_longitude : 126.978;

  const airlineCode = String(row.airline_code ?? "");
  const airline = AIRLINE_BY_CODE.get(airlineCode);
  const tripBucket = normalizeStayBucket(String(row.stay_bucket ?? DEFAULT_STAY_BUCKET));

  return {
    offer_id: String(row.offer_id ?? ""),
    origin: String(row.origin_airport ?? ""),
    origin_label: String(row.origin_airport ?? ""),
    traveler: String(row.traveler ?? DEFAULT_TRAVELER),
    destination_code: String(row.destination_city_id ?? row.destination_airport ?? ""),
    destination_city: String(row.dest_display_name_ko ?? row.destination_city_id ?? ""),
    destination_country: countryLabel(String(row.dest_country_code ?? "")),
    region_code: normalizeRegion(String(row.dest_region ?? "ALL")) as Offer["region_code"],
    region_label: regionLabel(String(row.dest_region ?? "")),
    lat,
    lon,
    depart_date: resolveDateOnly(row.depart_date),
    return_date: resolveDateOnly(row.return_date),
    stay_nights: Number(row.stay_nights ?? 0),
    trip_bucket: tripBucket as Offer["trip_bucket"],
    trip_bucket_label: String(TRIP_BUCKET_LABEL_BY_CODE.get(tripBucket) ?? tripBucket),
    airline_code: airlineCode,
    airline_name: String(row.airline_name ?? AIRLINE_NAME_BY_CODE.get(airlineCode) ?? airlineCode),
    cabin_group: normalizeCabin(String(row.cabin_group ?? "ALL")) as Offer["cabin_group"],
    cabin_label_raw: String(row.cabin_label_raw ?? airline?.businessLabel ?? "Economy"),
    fare_family: String(row.fare_brand_raw ?? "Standard"),
    price_total: Number(row.total_price ?? row.normalized_total_krw ?? 0),
    average_30_total: Number(row.average_30_total ?? row.normalized_total_krw ?? 0),
    average_90_total: Number(row.average_90_total ?? row.normalized_total_krw ?? 0),
    discount_pct_30: Number(row.discount_pct_30 ?? 0),
    discount_pct_90: Number(row.discount_pct_90 ?? 0),
    price_status: (normalizePriceStatus(String(row.price_status ?? "active")) ?? "active") as Offer["price_status"],
    is_price_changed: Boolean(row.is_price_changed),
    source_name: String(row.booking_source ?? row.source_id ?? ""),
    source_id: String(row.booking_source ?? row.source_id ?? ""),
    source_type: String(row.source_type ?? "airline_official") as Offer["source_type"],
    stops: Number(row.stop_count ?? 0),
    is_direct: Number(row.stop_count ?? 0) === 0,
    last_seen_at: resolveTimestampStr(row.last_seen_at) || fallbackBatchAt,
    last_batch_at: resolveTimestampStr(row.last_batch_at) || fallbackBatchAt,
    deep_link: String(row.deep_link ?? ""),
    official_promotion: Boolean(row.official_promotion),
    warning_flags: Array.isArray(row.warning_flags) ? row.warning_flags : [],
    badges: Array.isArray(row.badges) ? row.badges : [],
    outbound_departure_at: String(row.departure_time_local ?? ""),
    outbound_arrival_at: String(row.arrival_time_local ?? ""),
    inbound_departure_at: String(row.return_departure_time_local ?? ""),
    inbound_arrival_at: String(row.return_arrival_time_local ?? ""),
    duration_hours: Number(row.duration_minutes ? Number(row.duration_minutes) / 60 : row.duration_hours ?? 0),
  };
}

export function sortDeals(deals: MapDeal[], cabin: MapQuery["cabin"]) {
  return deals.sort((left, right) => {
    const leftValue =
      cabin === "BUSINESS"
        ? left.business_min_total ?? Number.MAX_SAFE_INTEGER
        : cabin === "ECONOMY"
          ? left.economy_min_total ?? Number.MAX_SAFE_INTEGER
          : Math.min(left.economy_min_total ?? Number.MAX_SAFE_INTEGER, left.business_min_total ?? Number.MAX_SAFE_INTEGER);
    const rightValue =
      cabin === "BUSINESS"
        ? right.business_min_total ?? Number.MAX_SAFE_INTEGER
        : cabin === "ECONOMY"
          ? right.economy_min_total ?? Number.MAX_SAFE_INTEGER
          : Math.min(right.economy_min_total ?? Number.MAX_SAFE_INTEGER, right.business_min_total ?? Number.MAX_SAFE_INTEGER);
    return leftValue - rightValue;
  });
}

export function passesAirlineFilter(deal: MapDeal, selectedAirlines: string[]) {
  if (!selectedAirlines.length) return true;
  return selectedAirlines.some(
    (airline) => deal.best_airline_by_cabin.ECONOMY === airline || deal.best_airline_by_cabin.BUSINESS === airline,
  );
}

export function buildMetaFromSourceFlags(flags: string[]) {
  const meta = getMetaData();
  return {
    ...meta,
    source_flags: flags,
  };
}
