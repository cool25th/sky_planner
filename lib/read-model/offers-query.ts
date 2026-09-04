import "server-only";

import { query as pgQuery } from "@/lib/db";
import { isHiddenFare } from "@/lib/fare-freshness";
import type { OffersData, OffersQuery } from "@/lib/mock-market";
import { eligibleBookingSourceKeys } from "@/lib/source-policy";
import { queryOrigins } from "./labels";
import { mapOfferFromSql, parseOfferJoinRow } from "./row-mappers";
import { postgresConfigured } from "./source-context";

export async function resolveOffersDataFromPostgres(
  offersQuery: OffersQuery,
  lastBatchAt: string,
  sourceFlags: string[],
): Promise<OffersData | null> {
  if (!postgresConfigured()) return null;
  if (!offersQuery.destination || !offersQuery.depart || !offersQuery.return) return null;
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
    WHERE o.origin_airport = ANY($1::text[])
      AND o.destination_city_id = $2
      AND o.depart_date = $3
      AND o.return_date = $4
      AND o.traveler = $5
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
  const { rows } = await pgQuery(sql, [
    queryOrigins(offersQuery.origin),
    offersQuery.destination,
    offersQuery.depart,
    offersQuery.return,
    offersQuery.traveler,
    eligibleSourceKeys,
  ]);

  const allOffers = rows.map((row) => mapOfferFromSql(parseOfferJoinRow(row), lastBatchAt));

  // UX-20260828-001 잔여: 0행(과거 출발일 등)은 null(데모 폴백) 대신 빈 live 목록으로 응답한다.
  const offers = allOffers
    .filter((offer) => {
      if (isHiddenFare(offer.last_seen_at || offer.last_batch_at)) return false;
      if (offersQuery.cabin !== "ALL" && offer.cabin_group !== offersQuery.cabin) return false;
      if (offersQuery.airline.length && !offersQuery.airline.includes(offer.airline_code)) return false;
      if (offersQuery.stops !== "ALL" && String(offer.stops) !== offersQuery.stops) return false;
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
    origin: offersQuery.origin,
    week: offersQuery.week,
    traveler: offersQuery.traveler,
    destination: offersQuery.destination,
    depart: offersQuery.depart,
    return: offersQuery.return,
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
