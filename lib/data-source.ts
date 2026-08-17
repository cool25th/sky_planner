import "server-only";

import {
  AIRLINES,
  DEFAULT_LAST_BATCH_AT,
  DEFAULT_STAY_BUCKET,
  DEFAULT_TRAVELER,
  GENERATED_AT,
  TRIP_BUCKETS,
  type ApiResponse,
  type CalendarData,
  type CalendarQuery,
  type DestinationMatch,
  type MapData,
  type MapDeal,
  type MapQuery,
  type Offer,
  type OffersData,
  type OffersQuery,
  type SearchDestination,
  type SearchQuery,
  type SearchResult,
  buildSearchResult,
  envelope,
  findDestinationMatches,
  getCalendarData,
  getMapData,
  getMetaData,
  getOffersData,
  getSearchResults,
  isBroadDestinationSearch,
} from "@/lib/mock-market";
import { getBatchState } from "@/lib/runtime-state";
import { query as pgQuery } from "@/lib/db";
import { isHiddenFare } from "@/lib/fare-freshness";
import { serviceApiReadinessBlockReason } from "@/lib/service-api-readiness";
import { buildSourceReadinessSnapshot } from "@/lib/source-readiness";
import { serviceRequiresPostgres } from "@/lib/service-mode";
import {
  buildCalendarDataFromOffers,
  eligibleReadModelSourceKeys,
  filterMapDealForSourceFlags,
  mapDealMatchesCabin,
} from "@/lib/read-model-source-filter";
import {
  eligibleBookingSourceKeys,
  enabledSourceFlagsFromEnv,
} from "@/lib/source-policy";

type FirestoreTimestampLike = Date | string | null | undefined;
type GeoPointLike = { latitude: number; longitude: number } | null | undefined;
type CalendarDestination = NonNullable<CalendarData["destination"]>;

const AIRLINE_NAME_BY_CODE = new Map(AIRLINES.map((airline) => [airline.code, airline.name]));
const AIRLINE_BY_CODE = new Map(AIRLINES.map((airline) => [airline.code, airline]));
const TRIP_BUCKET_LABEL_BY_CODE = new Map(TRIP_BUCKETS.map((bucket) => [bucket.code, bucket.label]));
const REGION_LABEL_BY_CODE = new Map(getMetaData().regions.map((region) => [region.code, region.label]));
const regionNames = new Intl.DisplayNames(["ko"], { type: "region" });

function postgresConfigured() {
  return Boolean(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
}

interface SourceContext {
  sourceFlags: string[];
  readiness: {
    status: string;
    counts: Record<string, unknown>;
    blocked_source_ids: string[];
  } | null;
  sourceHealthError: string | null;
}

async function resolveSourceContext(batchState: { lastBatchAt: string }): Promise<SourceContext> {
  const envFlags = enabledSourceFlagsFromEnv();
  if (!postgresConfigured() || !envFlags.length) {
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: null,
    };
  }

  try {
    const [healthResult, batchResult] = await Promise.all([
      pgQuery(`
        SELECT source_id, is_paused, enabled_by_flag, circuit_breaker_open, consecutive_failures, last_success_at
        FROM source_health
        WHERE source_id = ANY($1::text[])
      `, [envFlags]),
      pgQuery("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1"),
    ]);
    const readiness = buildSourceReadinessSnapshot({
      healthRows: healthResult.rows,
      batchState: batchResult.rows[0]?.data ?? {
        status: "unknown",
        last_batch_at: batchState.lastBatchAt,
      },
    });
    return {
      sourceFlags: readiness.source_flags,
      readiness: {
        status: readiness.status,
        counts: readiness.counts,
        blocked_source_ids: readiness.blocked_source_ids,
      },
      sourceHealthError: null,
    };
  } catch (err) {
    console.error("Failed to fetch source health from PostgreSQL, using env source flags.", err);
    return {
      sourceFlags: envFlags,
      readiness: null,
      sourceHealthError: "postgres_source_health_query_failed",
    };
  }
}

type ReadModel = "postgres" | "mock" | "unavailable";

function addDiagnostics<T>(
  response: ApiResponse<T>,
  readModel: ReadModel,
  sourceContext: SourceContext,
  fallbackReason: string | null = null,
): ApiResponse<T> {
  return {
    ...response,
    diagnostics: {
      read_model: readModel,
      postgres_configured: postgresConfigured(),
      fallback_used: readModel === "mock",
      fallback_suppressed: readModel === "unavailable",
      fallback_reason: fallbackReason,
      service_requires_postgres: serviceRequiresPostgres(),
      service_unavailable: readModel === "unavailable",
      source_flags: response.source_flags,
      source_readiness: sourceContext.readiness,
      source_health_error: sourceContext.sourceHealthError,
    },
  };
}

function sanitizedPostgresFailure(err: unknown) {
  console.error("Failed to fetch data from PostgreSQL.", err);
  return "postgres_query_failed";
}

function suppressMockFallback<T>(
  response: ApiResponse<T>,
  sourceContext: SourceContext,
  fallbackReason: string | null,
) {
  return addDiagnostics(
    {
      ...response,
      warning_flags: [...new Set([...response.warning_flags, "service_read_model_unavailable"])],
    },
    "unavailable",
    sourceContext,
    fallbackReason,
  );
}

function sourceReadinessFallbackReason(sourceContext: SourceContext) {
  return serviceApiReadinessBlockReason({
    postgresConfigured: postgresConfigured(),
    sourceHealthError: sourceContext.sourceHealthError,
    sourceReadiness: sourceContext.readiness,
  });
}

function isoMinute(value: FirestoreTimestampLike, fallback: string) {
  if (!value) return fallback;
  if (typeof value === "string") return value.slice(0, 16);
  if (value instanceof Date) return value.toISOString().slice(0, 16);
  return fallback;
}

function geoPoint(value: GeoPointLike, fallbackLat: number, fallbackLon: number) {
  return {
    lat: typeof value?.latitude === "number" ? value.latitude : fallbackLat,
    lon: typeof value?.longitude === "number" ? value.longitude : fallbackLon,
  };
}

function normalizeRegion(region?: string) {
  return (region?.toUpperCase() ?? "ALL") as MapQuery["region"];
}

function regionLabel(region?: string) {
  const normalized = normalizeRegion(region);
  return REGION_LABEL_BY_CODE.get(normalized) ?? String(region ?? "");
}

function countryLabel(countryCode?: string) {
  if (!countryCode) return "";
  const normalized = countryCode.toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) {
    return regionNames.of(normalized) ?? normalized;
  }
  return normalized;
}

function normalizeCabin(cabin?: string) {
  const normalized = cabin?.toUpperCase();
  if (normalized === "ECONOMY" || normalized === "BUSINESS") return normalized;
  return "ALL" as const;
}

function normalizeStayBucket(stayBucket?: string) {
  const normalized = stayBucket?.replace("-", "_");
  if (normalized === "3_4" || normalized === "5_7" || normalized === "8_14") return normalized;
  return DEFAULT_STAY_BUCKET;
}

function normalizePriceStatus(value?: string | null): "active" | "stale" | "sold_out" | null {
  if (value === "stale" || value === "sold_out" || value === "active") return value;
  return null;
}

function sortDeals(deals: MapDeal[], cabin: MapQuery["cabin"]) {
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

function passesAirlineFilter(deal: MapDeal, selectedAirlines: string[]) {
  if (!selectedAirlines.length) return true;
  return selectedAirlines.some(
    (airline) => deal.best_airline_by_cabin.ECONOMY === airline || deal.best_airline_by_cabin.BUSINESS === airline,
  );
}

function mapDealFromSql(row: any, fallbackBatchAt: string): MapDeal {
  const lat = typeof row.latitude === "number" ? row.latitude : 37.5665;
  const lon = typeof row.longitude === "number" ? row.longitude : 126.978;

  const resolveDateStr = (val: any) => {
    if (!val) return "";
    if (val instanceof Date) return val.toISOString().slice(0, 16);
    return String(val).slice(0, 16);
  };

  const lastBatch =
    resolveDateStr(row.economy_last_batch_at) ||
    resolveDateStr(row.business_last_batch_at) ||
    fallbackBatchAt;

  const lastSeen =
    resolveDateStr(row.economy_last_seen_at) ||
    resolveDateStr(row.business_last_seen_at) ||
    fallbackBatchAt;

  return {
    destination_code: String(row.destination_city_id ?? ""),
    city: String(row.destination_display_name ?? row.destination_city_id ?? ""),
    country: countryLabel(String(row.country_code ?? "")),
    region_code: normalizeRegion(String(row.region ?? "ALL")) as Exclude<MapQuery["region"], "ALL">,
    region_label: regionLabel(String(row.region ?? "")),
    lat,
    lon,
    economy_min_total: row.economy_min_total_krw !== null ? Number(row.economy_min_total_krw) : null,
    business_min_total: row.business_min_total_krw !== null ? Number(row.business_min_total_krw) : null,
    economy_discount_pct: row.economy_discount_pct !== null ? Number(row.economy_discount_pct) : null,
    business_discount_pct: row.business_discount_pct !== null ? Number(row.business_discount_pct) : null,
    economy_price_status: normalizePriceStatus(row.economy_price_status),
    business_price_status: normalizePriceStatus(row.business_price_status),
    best_airline_by_cabin: {
      ECONOMY: row.economy_representative_airline ?? null,
      BUSINESS: row.business_representative_airline ?? null,
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

function mapOfferFromSql(row: any, fallbackBatchAt: string): Offer {
  const lat = typeof row.dest_latitude === "number" ? row.dest_latitude : 37.5665;
  const lon = typeof row.dest_longitude === "number" ? row.dest_longitude : 126.978;

  const resolveDateStr = (val: any) => {
    if (!val) return "";
    if (val instanceof Date) return val.toISOString().slice(0, 16);
    return String(val).slice(0, 16);
  };

  const airlineCode = String(row.airline_code ?? "");
  const airline = AIRLINE_BY_CODE.get(airlineCode);
  const tripBucket = normalizeStayBucket(String(row.stay_bucket ?? DEFAULT_STAY_BUCKET));

  const formatSqlDate = (dateVal: any) => {
    if (!dateVal) return "";
    if (dateVal instanceof Date) {
      const y = dateVal.getFullYear();
      const m = String(dateVal.getMonth() + 1).padStart(2, "0");
      const d = String(dateVal.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(dateVal).slice(0, 10);
  };

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
    depart_date: formatSqlDate(row.depart_date),
    return_date: formatSqlDate(row.return_date),
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
    last_seen_at: resolveDateStr(row.last_seen_at) || fallbackBatchAt,
    last_batch_at: resolveDateStr(row.last_batch_at) || fallbackBatchAt,
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

function buildMetaFromSourceFlags(flags: string[]) {
  const meta = getMetaData();
  return {
    ...meta,
    source_flags: flags,
  };
}

async function resolveMapDataFromPostgres(query: MapQuery, lastBatchAt: string, sourceFlags: string[]): Promise<MapData | null> {
  if (!postgresConfigured()) return null;
  if (query.stay_bucket === "ALL") return null;
  const eligibleSourceKeys = eligibleReadModelSourceKeys(sourceFlags);
  if (!eligibleSourceKeys.size) return null;

  let sql = `
    SELECT 
      destination_city_id,
      destination_display_name,
      country_code,
      region,
      latitude,
      longitude,
      economy_min_total_krw,
      economy_discount_pct,
      economy_badge_type,
      economy_price_status,
      economy_best_depart_date,
      economy_best_return_date,
      economy_best_offer_id,
      economy_representative_airline,
      economy_representative_source,
      economy_deep_link,
      economy_last_seen_at,
      economy_last_batch_at,
      business_min_total_krw,
      business_discount_pct,
      business_badge_type,
      business_price_status,
      business_best_depart_date,
      business_best_return_date,
      business_best_offer_id,
      business_representative_airline,
      business_representative_source,
      business_deep_link,
      business_last_seen_at,
      business_last_batch_at,
      warning_flags,
      enabled_sources
    FROM deals_current
    WHERE origin = $1
      AND week = $2
      AND traveler = $3
      AND stay_bucket = $4
      AND is_active = true
      AND GREATEST(COALESCE(economy_best_depart_date, '1970-01-01'), COALESCE(business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
  `;
  const params: any[] = [query.origin, query.week, query.traveler, query.stay_bucket];

  if (query.region !== "ALL") {
    sql += ` AND region = $5`;
    params.push(query.region);
  }

  const { rows } = await pgQuery(sql, params);
  if (!rows.length) return null;

  const deals = sortDeals(
    rows
      .map((row) => filterMapDealForSourceFlags(mapDealFromSql(row, lastBatchAt), {
        economy_representative_source: row.economy_representative_source,
        business_representative_source: row.business_representative_source,
      }, sourceFlags))
      .filter((deal): deal is MapDeal => Boolean(deal))
      .filter((deal) => {
        if (!mapDealMatchesCabin(deal, query.cabin)) return false;
        if (query.budget != null) {
          const fare =
            query.cabin === "ECONOMY"
              ? deal.economy_min_total
              : query.cabin === "BUSINESS"
                ? deal.business_min_total
                : deal.economy_min_total ?? deal.business_min_total;
          if (fare == null || fare > query.budget) return false;
        }
        return passesAirlineFilter(deal, query.airlines);
      }),
    query.cabin,
  );

  const airlines = new Map<string, string>();
  for (const deal of deals) {
    if (deal.best_airline_by_cabin.ECONOMY) {
      airlines.set(deal.best_airline_by_cabin.ECONOMY, AIRLINE_NAME_BY_CODE.get(deal.best_airline_by_cabin.ECONOMY) ?? deal.best_airline_by_cabin.ECONOMY);
    }
    if (deal.best_airline_by_cabin.BUSINESS) {
      airlines.set(deal.best_airline_by_cabin.BUSINESS, AIRLINE_NAME_BY_CODE.get(deal.best_airline_by_cabin.BUSINESS) ?? deal.best_airline_by_cabin.BUSINESS);
    }
  }

  return {
    origin: query.origin,
    week: query.week,
    region: query.region,
    cabin: query.cabin,
    stay_bucket: query.stay_bucket,
    traveler: query.traveler,
    deals,
    available_airlines: [...airlines.entries()].map(([code, name]) => ({ code, name })),
    summary: {
      destinations: deals.length,
      offers_considered: deals.length,
      last_seen_at: deals[0]?.last_seen_at ?? null,
    },
  };
}

async function resolveCalendarDataFromPostgres(query: CalendarQuery, lastBatchAt: string, sourceFlags: string[]): Promise<CalendarData | null> {
  if (!postgresConfigured()) return null;
  if (query.stay_bucket === "ALL") return null;
  const eligibleSourceKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  if (!eligibleSourceKeys.length) return null;

  const dealSql = `
    SELECT 
      destination_city_id,
      destination_display_name,
      country_code,
      region,
      latitude,
      longitude,
      calendar_matrix,
      stay_bucket
    FROM deals_current
    WHERE origin = $1
      AND week = $2
      AND traveler = $3
      AND stay_bucket = $4
      AND destination_city_id = $5
      AND is_active = true
    LIMIT 1
  `;
  const { rows: dealRows } = await pgQuery(dealSql, [
    query.origin,
    query.week,
    query.traveler,
    query.stay_bucket,
    query.destination
  ]);
  const row = dealRows[0];
  if (!row) return null;

  const lat = typeof row.latitude === "number" ? row.latitude : 37.5665;
  const lon = typeof row.longitude === "number" ? row.longitude : 126.978;
  let offersSql = `
    SELECT
      o.*,
      p.latitude as dest_latitude,
      p.longitude as dest_longitude,
      p.display_name_ko as dest_display_name_ko,
      p.country_code as dest_country_code,
      p.region as dest_region
    FROM offers o
    LEFT JOIN places p ON p.place_id = o.destination_city_id
    WHERE o.origin_airport = $1
      AND o.destination_city_id = $2
      AND o.week = $3
      AND o.traveler = $4
    AND o.stay_bucket = $5
    AND o.is_active = true
    AND o.depart_date >= CURRENT_DATE
    AND COALESCE(o.bookability_status, 'available') <> 'sold_out'
      AND COALESCE(o.price_status, 'active') <> 'sold_out'
      AND COALESCE(o.price_anomaly_status, 'normal') = 'normal'
      AND COALESCE(o.quality_bucket, 'preferred') <> 'excluded'
      AND (
        LOWER(COALESCE(o.booking_source, '')) = ANY($6::text[])
        OR (
          LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
          AND LOWER(COALESCE(o.airline_code, '')) = ANY($6::text[])
        )
      )
  `;
  const params: any[] = [
    query.origin,
    query.destination,
    query.week,
    query.traveler,
    query.stay_bucket,
    eligibleSourceKeys,
  ];
  if (query.cabin !== "ALL") {
    offersSql += ` AND UPPER(o.cabin_group) = $${params.length + 1}`;
    params.push(query.cabin);
  }
  if (query.airlines.length) {
    offersSql += ` AND o.airline_code = ANY($${params.length + 1}::text[])`;
    params.push(query.airlines);
  }
  offersSql += `
    ORDER BY o.depart_date ASC, o.return_date ASC, COALESCE(o.normalized_total_krw, o.total_price) ASC
  `;

  const { rows: offerRows } = await pgQuery(offersSql, params);
  const offers = offerRows.map((offerRow) => mapOfferFromSql(offerRow, lastBatchAt));
  if (!offers.length) return null;

  return buildCalendarDataFromOffers(query, {
    code: String(row.destination_city_id ?? query.destination),
    city: String(row.destination_display_name ?? query.destination),
    country: countryLabel(String(row.country_code ?? "")),
    region_code: normalizeRegion(String(row.region ?? "ALL")) as CalendarDestination["region_code"],
    region_label: regionLabel(String(row.region ?? "")),
    lat,
    lon,
  }, offers);
}

async function resolveOffersDataFromPostgres(query: OffersQuery, lastBatchAt: string, sourceFlags: string[]): Promise<OffersData | null> {
  if (!postgresConfigured()) return null;
  if (!query.destination || !query.depart || !query.return) return null;
  const eligibleSourceKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  if (!eligibleSourceKeys.length) return null;

  const sql = `
    SELECT 
      o.*,
      p.latitude as dest_latitude,
      p.longitude as dest_longitude,
      p.display_name_ko as dest_display_name_ko,
      p.country_code as dest_country_code,
      p.region as dest_region
    FROM offers o
    LEFT JOIN places p ON p.place_id = o.destination_city_id
    WHERE o.origin_airport = $1
      AND o.destination_city_id = $2
      AND o.depart_date = $3
      AND o.return_date = $4
      AND o.traveler = $5
      AND o.is_active = true
      AND o.depart_date >= CURRENT_DATE
      AND (
        LOWER(COALESCE(o.booking_source, '')) = ANY($6::text[])
        OR (
          LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
          AND LOWER(COALESCE(o.airline_code, '')) = ANY($6::text[])
        )
      )
  `;
  const { rows } = await pgQuery(sql, [
    query.origin,
    query.destination,
    query.depart,
    query.return,
    query.traveler,
    eligibleSourceKeys,
  ]);

  const allOffers = rows.map((row) => mapOfferFromSql(row, lastBatchAt));
  if (!allOffers.length) return null;

  const offers = allOffers
    .filter((offer) => {
      if (isHiddenFare(offer.last_seen_at || offer.last_batch_at)) return false;
      if (query.cabin !== "ALL" && offer.cabin_group !== query.cabin) return false;
      if (query.airline.length && !query.airline.includes(offer.airline_code)) return false;
      if (query.stops !== "ALL" && String(offer.stops) !== query.stops) return false;
      return true;
    })
    .sort((left, right) => left.price_total - right.price_total);

  const airlineMap = new Map<string, string>();
  const cabinMap = new Map<string, string>();
  const stopSet = new Set<number>();

  for (const offer of allOffers) {
    airlineMap.set(offer.airline_code, offer.airline_name);
    cabinMap.set(offer.cabin_group, offer.cabin_group === "BUSINESS" ? "비즈니스" : "이코노미");
    stopSet.add(offer.stops);
  }

  return {
    origin: query.origin,
    week: query.week,
    traveler: query.traveler,
    destination: query.destination,
    depart: query.depart,
    return: query.return,
    offers,
    filters: {
      available_airlines: [...airlineMap.entries()].map(([code, name]) => ({ code, name })),
      available_cabins: [...cabinMap.entries()].map(([code, label]) => ({ code, label })),
      available_stops: [...stopSet].sort((left, right) => left - right),
    },
    summary: {
      count: offers.length,
      lowest_total: offers[0]?.price_total ?? null,
      last_seen_at: offers[0]?.last_seen_at ?? null,
    },
  };
}

async function resolveSearchDataFromPostgres(query: SearchQuery, lastBatchAt: string, sourceFlags: string[]): Promise<SearchResult | null> {
  if (!postgresConfigured()) return null;
  const destinationInput = (query.destination_input || query.destination).trim();
  if (!destinationInput) return null;

  const localMatches = findDestinationMatches(destinationInput);
  const localMatchByCode = new Map(localMatches.map((match) => [match.code, match]));
  const localMatchCodes = localMatches.map((match) => match.code);
  const destinationSql = `
    SELECT
      place_id,
      display_name_ko,
      display_name_en,
      country_code,
      region,
      CASE
        WHEN UPPER(place_id) = $1 THEN 120
        WHEN UPPER(COALESCE(iata_code, '')) = $1 THEN 115
        WHEN LOWER(display_name_ko) = $2 THEN 108
        WHEN LOWER(display_name_en) = $2 THEN 104
        WHEN place_id = ANY($4::text[]) THEN 96
        WHEN LOWER(display_name_ko) LIKE $3 THEN 86
        WHEN LOWER(display_name_en) LIKE $3 THEN 82
        ELSE 54
      END AS score
    FROM places
    WHERE is_active = true
      AND place_type = 'city'
      AND (
        UPPER(place_id) = $1
        OR UPPER(COALESCE(iata_code, '')) = $1
        OR place_id = ANY($4::text[])
        OR LOWER(display_name_ko) LIKE $3
        OR LOWER(display_name_en) LIKE $3
      )
    ORDER BY score DESC, display_name_ko ASC
    LIMIT 8
  `;
  const normalized = destinationInput.toLowerCase();
  const { rows: destinationRows } = await pgQuery(destinationSql, [
    destinationInput.toUpperCase(),
    normalized,
    `%${normalized}%`,
    localMatchCodes,
  ]);

  if (!destinationRows.length) return null;

  const matches: DestinationMatch[] = destinationRows.map((row: any) => ({
    code: String(row.place_id ?? ""),
    city: String(row.display_name_ko ?? row.display_name_en ?? row.place_id ?? ""),
    country: countryLabel(String(row.country_code ?? "")),
    region: normalizeRegion(String(row.region ?? "ALL")) as DestinationMatch["region"],
    score: Math.max(Number(row.score ?? 0), localMatchByCode.get(String(row.place_id ?? ""))?.score ?? 0),
    matched_by: localMatchByCode.get(String(row.place_id ?? ""))?.matched_by ?? "database",
  }));
  const broadSearch = isBroadDestinationSearch(destinationInput, localMatches);
  const destinationRowsByCode = new Map(destinationRows.map((row: any) => [String(row.place_id ?? ""), row]));
  const selectedDestinationRows = broadSearch
    ? localMatchCodes.map((code) => destinationRowsByCode.get(code)).filter((row): row is any => Boolean(row))
    : [destinationRows[0]];
  if (!selectedDestinationRows.length) return null;

  const searchedDestinations: SearchDestination[] = selectedDestinationRows.map((row: any) => ({
    code: String(row.place_id ?? ""),
    city: String(row.display_name_ko ?? row.display_name_en ?? row.place_id ?? ""),
    country: countryLabel(String(row.country_code ?? "")),
    region: normalizeRegion(String(row.region ?? "ALL")) as DestinationMatch["region"],
  }));
  const primaryDestination = searchedDestinations[0] ?? null;
  if (!primaryDestination) return null;
  const minNights = Math.max(3, query.days - query.flex_days);
  const maxNights = Math.min(14, query.days + query.flex_days);
  const selectedDestinationCodes = searchedDestinations.map((destination) => destination.code);
  const eligibleSourceKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  if (!eligibleSourceKeys.length) {
    return buildSearchResult(query, primaryDestination, matches, [], searchedDestinations);
  }

  let offersWhereSql = `
    WHERE o.origin_airport = $1
      AND o.destination_city_id = ANY($2::text[])
      AND o.traveler = $3
      AND o.is_active = true
      AND o.depart_date >= CURRENT_DATE
      AND COALESCE(o.bookability_status, 'available') <> 'sold_out'
      AND COALESCE(o.price_status, 'active') <> 'sold_out'
      AND COALESCE(o.price_anomaly_status, 'normal') = 'normal'
      AND COALESCE(o.quality_bucket, 'preferred') <> 'excluded'
      AND o.stay_nights BETWEEN $4 AND $5
      AND (
        LOWER(COALESCE(o.booking_source, '')) = ANY($6::text[])
        OR (
          LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
          AND LOWER(COALESCE(o.airline_code, '')) = ANY($6::text[])
        )
      )
  `;
  const params: any[] = [query.origin, selectedDestinationCodes, query.traveler ?? DEFAULT_TRAVELER, minNights, maxNights, eligibleSourceKeys];
  if (query.cabin !== "ALL") {
    offersWhereSql += ` AND UPPER(o.cabin_group) = $${params.length + 1}`;
    params.push(query.cabin);
  }
  const perDestinationLimit = selectedDestinationCodes.length > 1 ? 120 : 240;
  const globalLimit = Math.min(720, selectedDestinationCodes.length * perDestinationLimit);
  params.push(perDestinationLimit, globalLimit);
  const perDestinationLimitParam = params.length - 1;
  const globalLimitParam = params.length;
  const offersSql = `
    WITH ranked_offers AS (
      SELECT
        o.*,
        p.latitude as dest_latitude,
        p.longitude as dest_longitude,
        p.display_name_ko as dest_display_name_ko,
        p.country_code as dest_country_code,
        p.region as dest_region,
        ROW_NUMBER() OVER (
          PARTITION BY o.destination_city_id
          ORDER BY
            COALESCE(o.normalized_total_krw, o.total_price) ASC,
            CASE WHEN o.stop_count = 0 THEN 0 ELSE 1 END ASC,
            COALESCE(o.duration_minutes, 99999) ASC,
            o.depart_date ASC
        ) AS destination_rank
      FROM offers o
      LEFT JOIN places p ON p.place_id = o.destination_city_id
      ${offersWhereSql}
    )
    SELECT *
    FROM ranked_offers
    WHERE destination_rank <= $${perDestinationLimitParam}
    ORDER BY
      COALESCE(normalized_total_krw, total_price) ASC,
      CASE WHEN stop_count = 0 THEN 0 ELSE 1 END ASC,
      COALESCE(duration_minutes, 99999) ASC,
      depart_date ASC
    LIMIT $${globalLimitParam}
  `;

  const { rows: offerRows } = await pgQuery(offersSql, params);
  const offers = offerRows.map((row) => mapOfferFromSql(row, lastBatchAt));
  return buildSearchResult(query, primaryDestination, matches, offers, searchedDestinations);
}

export async function resolveMetaResponse(): Promise<ApiResponse<ReturnType<typeof getMetaData> & { source_flags?: string[] }>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  return addDiagnostics(
    envelope("meta", {}, buildMetaFromSourceFlags(sourceContext.sourceFlags), batchState.lastBatchAt, sourceContext.sourceFlags),
    postgresConfigured() ? "postgres" : "mock",
    sourceContext,
  );
}

export async function resolveMapResponse(query: MapQuery): Promise<ApiResponse<MapData>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    return suppressMockFallback(
      envelope(
        "deals-map",
        {
          origin: query.origin,
          week: query.week,
          region: query.region,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getMapData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      readinessFallbackReason,
    );
  }
  let fallbackReason: string | null = null;
  try {
    const postgresData = await resolveMapDataFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        {
          ...envelope(
            "deals-map",
            {
              origin: query.origin,
              week: query.week,
              region: query.region,
              stay_bucket: query.stay_bucket,
              traveler: query.traveler,
              cabin: query.cabin,
              airlines: query.airlines.join(","),
            },
            postgresData,
            batchState.lastBatchAt,
            sourceFlags,
          ),
          warning_flags: ["daily_batch_cached"],
        },
        "postgres",
        sourceContext,
      );
    }
    fallbackReason = postgresConfigured() ? "postgres_no_matching_rows" : "postgres_not_configured";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  if (serviceRequiresPostgres()) {
    return suppressMockFallback(
      envelope(
        "deals-map",
        {
          origin: query.origin,
          week: query.week,
          region: query.region,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getMapData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      fallbackReason,
    );
  }

  return addDiagnostics(
    {
      ...envelope(
        "deals-map",
        {
          origin: query.origin,
          week: query.week,
          region: query.region,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getMapData(query, batchState.lastBatchAt, sourceFlags),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      warning_flags: ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"],
    },
    "mock",
    sourceContext,
    fallbackReason,
  );
}

export async function resolveCalendarResponse(query: CalendarQuery): Promise<ApiResponse<CalendarData>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    return suppressMockFallback(
      envelope(
        "deals-calendar",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getCalendarData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      readinessFallbackReason,
    );
  }
  let fallbackReason: string | null = null;
  try {
    const postgresData = await resolveCalendarDataFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        envelope(
          "deals-calendar",
          {
            origin: query.origin,
            week: query.week,
            destination: query.destination,
            stay_bucket: query.stay_bucket,
            traveler: query.traveler,
            cabin: query.cabin,
            airlines: query.airlines.join(","),
          },
          postgresData,
          batchState.lastBatchAt,
          sourceFlags,
        ),
        "postgres",
        sourceContext,
      );
    }
    fallbackReason = postgresConfigured() ? "postgres_no_matching_rows" : "postgres_not_configured";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  if (serviceRequiresPostgres()) {
    return suppressMockFallback(
      envelope(
        "deals-calendar",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getCalendarData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      fallbackReason,
    );
  }

  return addDiagnostics(
    {
      ...envelope(
        "deals-calendar",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          stay_bucket: query.stay_bucket,
          traveler: query.traveler,
          cabin: query.cabin,
          airlines: query.airlines.join(","),
        },
        getCalendarData(query, batchState.lastBatchAt, sourceFlags),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      warning_flags: ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"],
    },
    "mock",
    sourceContext,
    fallbackReason,
  );
}

export async function resolveOffersResponse(query: OffersQuery): Promise<ApiResponse<OffersData>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    return suppressMockFallback(
      envelope(
        "offers",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          depart: query.depart,
          return: query.return,
          traveler: query.traveler,
          cabin: query.cabin,
          airline: query.airline.join(","),
          stops: query.stops,
        },
        getOffersData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      readinessFallbackReason,
    );
  }
  let fallbackReason: string | null = null;
  try {
    const postgresData = await resolveOffersDataFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        envelope(
          "offers",
          {
            origin: query.origin,
            week: query.week,
            destination: query.destination,
            depart: query.depart,
            return: query.return,
            traveler: query.traveler,
            cabin: query.cabin,
            airline: query.airline.join(","),
            stops: query.stops,
          },
          postgresData,
          batchState.lastBatchAt,
          sourceFlags,
        ),
        "postgres",
        sourceContext,
      );
    }
    fallbackReason = postgresConfigured() ? "postgres_no_matching_rows" : "postgres_not_configured";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  if (serviceRequiresPostgres()) {
    return suppressMockFallback(
      envelope(
        "offers",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          depart: query.depart,
          return: query.return,
          traveler: query.traveler,
          cabin: query.cabin,
          airline: query.airline.join(","),
          stops: query.stops,
        },
        getOffersData(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      fallbackReason,
    );
  }

  return addDiagnostics(
    {
      ...envelope(
        "offers",
        {
          origin: query.origin,
          week: query.week,
          destination: query.destination,
          depart: query.depart,
          return: query.return,
          traveler: query.traveler,
          cabin: query.cabin,
          airline: query.airline.join(","),
          stops: query.stops,
        },
        getOffersData(query, batchState.lastBatchAt, sourceFlags),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      warning_flags: ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"],
    },
    "mock",
    sourceContext,
    fallbackReason,
  );
}

export async function resolveSearchResponse(query: SearchQuery): Promise<ApiResponse<SearchResult>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    return suppressMockFallback(
      envelope(
        "fare-search",
        {
          origin: query.origin,
          destination: query.destination,
          q: query.destination_input,
          days: String(query.days),
          flex: String(query.flex_days),
          cabin: query.cabin,
        },
        getSearchResults(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      readinessFallbackReason,
    );
  }
  let fallbackReason: string | null = null;
  try {
    const postgresData = await resolveSearchDataFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        {
          ...envelope(
            "fare-search",
            {
              origin: query.origin,
              destination: query.destination,
              q: query.destination_input,
              days: String(query.days),
              flex: String(query.flex_days),
              cabin: query.cabin,
            },
            postgresData,
            batchState.lastBatchAt,
            sourceFlags,
          ),
          warning_flags: ["daily_batch_cached", "final_price_check_on_booking_source"],
        },
        "postgres",
        sourceContext,
      );
    }
    fallbackReason = postgresConfigured() ? "postgres_no_matching_rows" : "postgres_not_configured";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  if (serviceRequiresPostgres()) {
    return suppressMockFallback(
      envelope(
        "fare-search",
        {
          origin: query.origin,
          destination: query.destination,
          q: query.destination_input,
          days: String(query.days),
          flex: String(query.flex_days),
          cabin: query.cabin,
        },
        getSearchResults(query, batchState.lastBatchAt, []),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      sourceContext,
      fallbackReason,
    );
  }

  return addDiagnostics(
    {
      ...envelope(
        "fare-search",
        {
          origin: query.origin,
          destination: query.destination,
          q: query.destination_input,
          days: String(query.days),
          flex: String(query.flex_days),
          cabin: query.cabin,
        },
        getSearchResults(query, batchState.lastBatchAt, sourceFlags),
        batchState.lastBatchAt,
        sourceFlags,
      ),
      warning_flags: ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"],
    },
    "mock",
    sourceContext,
    fallbackReason,
  );
}

export function defaultBatchAt() {
  return DEFAULT_LAST_BATCH_AT;
}

export function generatedAt() {
  return GENERATED_AT;
}
