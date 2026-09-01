import "server-only";

import { query as pgQuery } from "@/lib/db";
import {
  buildSearchResult,
  DEFAULT_TRAVELER,
  type DestinationMatch,
  findDestinationMatches,
  isBroadDestinationSearch,
  type SearchDestination,
  type SearchQuery,
  type SearchResult,
} from "@/lib/mock-market";
import { eligibleBookingSourceKeys } from "@/lib/source-policy";
import { countryLabel, normalizeRegion } from "./labels";
import { mapOfferFromSql, parseOfferJoinRow } from "./row-mappers";
import { postgresConfigured } from "./source-context";

export async function resolveSearchDataFromPostgres(
  searchQuery: SearchQuery,
  lastBatchAt: string,
  sourceFlags: string[],
): Promise<SearchResult | null> {
  if (!postgresConfigured()) return null;
  const destinationInput = (searchQuery.destination_input || searchQuery.destination).trim();
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

  const matches: DestinationMatch[] = destinationRows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return {
      code: String(row.place_id ?? ""),
      city: String(row.display_name_ko ?? row.display_name_en ?? row.place_id ?? ""),
      country: countryLabel(String(row.country_code ?? "")),
      region: normalizeRegion(String(row.region ?? "ALL")) as DestinationMatch["region"],
      score: Math.max(Number(row.score ?? 0), localMatchByCode.get(String(row.place_id ?? ""))?.score ?? 0),
      matched_by: localMatchByCode.get(String(row.place_id ?? ""))?.matched_by ?? "database",
    };
  });
  const broadSearch = isBroadDestinationSearch(destinationInput, localMatches);
  const destinationRowsByCode = new Map(destinationRows.map((rawRow) => [String((rawRow as Record<string, unknown>).place_id ?? ""), rawRow]));
  const selectedDestinationRows = broadSearch
    ? localMatchCodes.map((code) => destinationRowsByCode.get(code)).filter((row): row is Record<string, unknown> => Boolean(row))
    : [destinationRows[0] as Record<string, unknown>];
  if (!selectedDestinationRows.length) return null;

  const searchedDestinations: SearchDestination[] = selectedDestinationRows.map((row) => ({
    code: String(row.place_id ?? ""),
    city: String(row.display_name_ko ?? row.display_name_en ?? row.place_id ?? ""),
    country: countryLabel(String(row.country_code ?? "")),
    region: normalizeRegion(String(row.region ?? "ALL")) as DestinationMatch["region"],
  }));
  const primaryDestination = searchedDestinations[0] ?? null;
  if (!primaryDestination) return null;
  const minNights = Math.max(3, searchQuery.days - searchQuery.flex_days);
  const maxNights = Math.min(14, searchQuery.days + searchQuery.flex_days);
  const selectedDestinationCodes = searchedDestinations.map((destination) => destination.code);
  const eligibleSourceKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  if (!eligibleSourceKeys.length) {
    return buildSearchResult(searchQuery, primaryDestination, matches, [], searchedDestinations);
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
  const params: unknown[] = [searchQuery.origin, selectedDestinationCodes, searchQuery.traveler ?? DEFAULT_TRAVELER, minNights, maxNights, eligibleSourceKeys];
  if (searchQuery.cabin !== "ALL") {
    offersWhereSql += ` AND UPPER(o.cabin_group) = $${params.length + 1}`;
    params.push(searchQuery.cabin);
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
  const offers = offerRows.map((row) => mapOfferFromSql(parseOfferJoinRow(row), lastBatchAt));
  return buildSearchResult(searchQuery, primaryDestination, matches, offers, searchedDestinations);
}
