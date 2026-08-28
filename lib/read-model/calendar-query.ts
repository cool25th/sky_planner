import "server-only";

import { query as pgQuery } from "@/lib/db";
import type { CalendarData, CalendarQuery } from "@/lib/mock-market";
import { buildCalendarDataFromOffers } from "@/lib/read-model-source-filter";
import { eligibleBookingSourceKeys } from "@/lib/source-policy";
import { countryLabel, normalizeRegion, queryOrigins, regionLabel } from "./labels";
import { postgresConfigured } from "./source-context";
import { mapOfferFromSql, parseOfferJoinRow } from "./row-mappers";

type CalendarDestination = NonNullable<CalendarData["destination"]>;

export async function resolveCalendarDataFromPostgres(
  calendarQuery: CalendarQuery,
  lastBatchAt: string,
  sourceFlags: string[],
): Promise<CalendarData | null> {
  if (!postgresConfigured()) return null;
  if (calendarQuery.stay_bucket === "ALL") return null;
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
    WHERE origin = ANY($1::text[])
      AND week = $2
      AND traveler = $3
      AND stay_bucket = $4
      AND destination_city_id = $5
      AND is_active = true
    LIMIT 1
  `;
  const { rows: dealRows } = await pgQuery(dealSql, [
    queryOrigins(calendarQuery.origin),
    calendarQuery.week,
    calendarQuery.traveler,
    calendarQuery.stay_bucket,
    calendarQuery.destination,
  ]);
  const dealRow = dealRows[0] as Record<string, unknown> | undefined;
  // UX-20260828-001 잔여: 쿼리한 주간에 데이터가 없으면(과거 주간) null(데모 폴백) 대신
  // 빈 live 달력으로 응답한다 — UI는 destination null·빈 cells를 이미 안전 처리한다.
  if (!dealRow) return buildCalendarDataFromOffers(calendarQuery, null, []);

  const lat = typeof dealRow.latitude === "number" ? dealRow.latitude : 37.5665;
  const lon = typeof dealRow.longitude === "number" ? dealRow.longitude : 126.978;
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
    WHERE o.origin_airport = ANY($1::text[])
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
  const params: unknown[] = [
    queryOrigins(calendarQuery.origin),
    calendarQuery.destination,
    calendarQuery.week,
    calendarQuery.traveler,
    calendarQuery.stay_bucket,
    eligibleSourceKeys,
  ];
  if (calendarQuery.cabin !== "ALL") {
    offersSql += ` AND UPPER(o.cabin_group) = $${params.length + 1}`;
    params.push(calendarQuery.cabin);
  }
  if (calendarQuery.airlines.length) {
    offersSql += ` AND o.airline_code = ANY($${params.length + 1}::text[])`;
    params.push(calendarQuery.airlines);
  }
  offersSql += `
    ORDER BY o.depart_date ASC, o.return_date ASC, COALESCE(o.normalized_total_krw, o.total_price) ASC
  `;

  const { rows: offerRows } = await pgQuery(offersSql, params);
  const offers = offerRows.map((offerRow) => mapOfferFromSql(parseOfferJoinRow(offerRow), lastBatchAt));

  return buildCalendarDataFromOffers(calendarQuery, {
    code: String(dealRow.destination_city_id ?? calendarQuery.destination),
    city: String(dealRow.destination_display_name ?? calendarQuery.destination),
    country: countryLabel(String(dealRow.country_code ?? "")),
    region_code: normalizeRegion(String(dealRow.region ?? "ALL")) as CalendarDestination["region_code"],
    region_label: regionLabel(String(dealRow.region ?? "")),
    lat,
    lon,
  }, offers);
}
