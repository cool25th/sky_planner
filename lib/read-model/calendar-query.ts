import "server-only";

import { query as pgQuery } from "@/lib/db";
import { weekStartDate } from "@/lib/format";
import { type CalendarData, type CalendarQuery, isoWeekCode } from "@/lib/mock-market";
import { buildCalendarDataFromOffers } from "@/lib/read-model-source-filter";
import { eligibleBookingSourceKeys } from "@/lib/source-policy";
import { countryLabel, normalizeRegion, queryOrigins, regionLabel } from "./labels";
import { LIVE_OFFER_VISIBILITY_SQL } from "./live-offer-policy";
import { mapOfferFromSql, parseOfferJoinRow } from "./row-mappers";
import { postgresConfigured } from "./source-context";

type CalendarDestination = NonNullable<CalendarData["destination"]>;

// DATA-20260908-001: 운영 게이트 차단·쿼리 실패 시 mock 페이로드 대신 내리는 빈 live 형태.
export function emptyCalendarDataForQuery(calendarQuery: CalendarQuery): CalendarData {
  return buildCalendarDataFromOffers(calendarQuery, null, []);
}

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
  // 외부 검토 2026-10-04(P0): 빈 주간도 목적지 셸(places)과 인접 대안 주를 실어 보낸다 —
  // destination null은 색인 진입 URL이 "불러올 수 없습니다" 오해 문구로 끊기는 근원이었다.
  if (!dealRow) {
    const [destination, alternativeWeeks] = await Promise.all([
      calendarDestinationFromPlace(calendarQuery.destination),
      activeAdjacentWeeks(calendarQuery),
    ]);
    return { ...buildCalendarDataFromOffers(calendarQuery, destination, []), alternative_weeks: alternativeWeeks };
  }

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
	    AND ${LIVE_OFFER_VISIBILITY_SQL}
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

// 딜 행 없이 목적지 식별 정보만 places에서 — 빈 주간 셸 렌더용.
async function calendarDestinationFromPlace(placeId: string): Promise<CalendarDestination | null> {
  const { rows } = await pgQuery(`
    SELECT place_id, display_name_ko, country_code, region, latitude, longitude
    FROM places
    WHERE place_id = $1 AND is_active = true
    LIMIT 1
  `, [placeId]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    code: String(row.place_id ?? placeId),
    city: String(row.display_name_ko ?? placeId),
    country: countryLabel(String(row.country_code ?? "")),
    region_code: normalizeRegion(String(row.region ?? "ALL")) as CalendarDestination["region_code"],
    region_label: regionLabel(String(row.region ?? "")),
    lat: typeof row.latitude === "number" ? row.latitude : 37.5665,
    lon: typeof row.longitude === "number" ? row.longitude : 126.978,
  };
}

// 이 목적지·버킷에 활성 딜이 남은 인접 주(다음 2주·지난 1주) — 빈 주간 제안 링크용.
// 배치가 live 조인 없는 딜 그룹을 자동 비활성화하므로 is_active만으로 충분하다.
async function activeAdjacentWeeks(calendarQuery: CalendarQuery): Promise<string[]> {
  const mondays = [-1, 1, 2].map((offset) => {
    const monday = weekStartDate(calendarQuery.week);
    if (!monday) return null;
    monday.setUTCDate(monday.getUTCDate() + offset * 7);
    return isoWeekCode(monday);
  });
  const weeks = [...new Set(mondays.filter((week): week is string => Boolean(week) && week !== calendarQuery.week))];
  if (!weeks.length) return [];
  const { rows } = await pgQuery(`
    SELECT DISTINCT week
    FROM deals_current
    WHERE origin = ANY($1::text[])
      AND traveler = $2
      AND stay_bucket = $3
      AND destination_city_id = $4
      AND is_active = true
      AND week = ANY($5::text[])
      AND GREATEST(COALESCE(economy_best_depart_date, '1970-01-01'), COALESCE(business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
    ORDER BY 1
  `, [queryOrigins(calendarQuery.origin), calendarQuery.traveler, calendarQuery.stay_bucket, calendarQuery.destination, weeks]);
  return rows.map((row) => String(row.week));
}
