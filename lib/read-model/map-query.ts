import "server-only";

import { query as pgQuery } from "@/lib/db";
import type { MapData, MapDeal, MapQuery } from "@/lib/mock-market";
import {
  eligibleReadModelSourceKeys,
  filterMapDealForSourceFlags,
  mapDealMatchesCabin,
} from "@/lib/read-model-source-filter";
import { AIRLINE_NAME_BY_CODE, queryOrigins } from "./labels";
import { mapDealFromSql, mergeMapDeals, parseDealCurrentRow, passesAirlineFilter, sortDeals } from "./row-mappers";
import { postgresConfigured } from "./source-context";

// UX-20260828-001: 쿼리는 실행했지만 예약 가능한 출발일이 없는 경우(주 후반·과거 주간·조건 무일치).
// null을 반환하면 "DB 미구성"과 같은 mock 폴백(데모 가격 표시)으로 내려가므로 빈 live 결과로 응답한다.
export function emptyMapDataForQuery(mapQuery: MapQuery): MapData {
  return {
    origin: mapQuery.origin,
    week: mapQuery.week,
    region: mapQuery.region,
    cabin: mapQuery.cabin,
    stay_bucket: mapQuery.stay_bucket,
    traveler: mapQuery.traveler,
    deals: [],
    available_airlines: [],
    summary: { destinations: 0, offers_considered: 0, last_seen_at: null },
  };
}

export async function resolveMapDataFromPostgres(mapQuery: MapQuery, lastBatchAt: string, sourceFlags: string[]): Promise<MapData | null> {
  if (!postgresConfigured()) return null;
  if (mapQuery.stay_bucket === "ALL") return null;
  const eligibleSourceKeys = eligibleReadModelSourceKeys(sourceFlags);
  if (!eligibleSourceKeys.size) return null;

  let sql = `
    SELECT
      origin,
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
    WHERE origin = ANY($1::text[])
      AND week = $2
      AND traveler = $3
      AND stay_bucket = $4
      AND is_active = true
      AND GREATEST(COALESCE(economy_best_depart_date, '1970-01-01'), COALESCE(business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
  `;
  const params: unknown[] = [queryOrigins(mapQuery.origin), mapQuery.week, mapQuery.traveler, mapQuery.stay_bucket];

  if (mapQuery.region !== "ALL") {
    sql += ` AND region = $5`;
    params.push(mapQuery.region);
  }

  const { rows } = await pgQuery(sql, params);
  if (!rows.length) return emptyMapDataForQuery(mapQuery);

  const rowsByDestination = new Map<string, unknown[]>();
  for (const row of rows) {
    const key = String((row as Record<string, unknown>).destination_city_id ?? "");
    rowsByDestination.set(key, [...(rowsByDestination.get(key) ?? []), row]);
  }

  const deals = sortDeals(
    [...rowsByDestination.values()]
      .map((groupRows) => {
        const mapped = groupRows
          .map((rawRow) => {
            const row = parseDealCurrentRow(rawRow);
            const deal = filterMapDealForSourceFlags(mapDealFromSql(row, lastBatchAt), {
              economy_representative_source: row.economy_representative_source ?? null,
              business_representative_source: row.business_representative_source ?? null,
            }, sourceFlags);
            return deal;
          })
          .filter((deal): deal is MapDeal => Boolean(deal));
        return mapped.length ? mergeMapDeals(mapped) : null;
      })
      .filter((deal): deal is MapDeal => deal !== null)
      .filter((deal) => {
        if (!mapDealMatchesCabin(deal, mapQuery.cabin)) return false;
        if (mapQuery.budget != null) {
          const fare =
            mapQuery.cabin === "ECONOMY"
              ? deal.economy_min_total
              : mapQuery.cabin === "BUSINESS"
                ? deal.business_min_total
                : deal.economy_min_total ?? deal.business_min_total;
          if (fare == null || fare > mapQuery.budget) return false;
        }
        return passesAirlineFilter(deal, mapQuery.airlines);
      }),
    mapQuery.cabin,
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
    origin: mapQuery.origin,
    week: mapQuery.week,
    region: mapQuery.region,
    cabin: mapQuery.cabin,
    stay_bucket: mapQuery.stay_bucket,
    traveler: mapQuery.traveler,
    deals,
    available_airlines: [...airlines.entries()].map(([code, name]) => ({ code, name })),
    summary: {
      destinations: deals.length,
      offers_considered: deals.length,
      last_seen_at: deals[0]?.last_seen_at ?? null,
    },
  };
}
