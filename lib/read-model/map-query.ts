import "server-only";

import { query as pgQuery } from "@/lib/db";
import type { MapData, MapDeal, MapQuery } from "@/lib/mock-market";
import {
  eligibleReadModelSourceKeys,
  filterMapDealForSourceFlags,
  mapDealMatchesCabin,
} from "@/lib/read-model-source-filter";
import { weekStartDate } from "../format";
import { isoWeekCode, TRIP_BUCKETS } from "../mock-market";
import { AIRLINE_NAME_BY_CODE, queryOrigins, TRIP_BUCKET_LABEL_BY_CODE } from "./labels";
import { LIVE_OFFER_VISIBILITY_SQL } from "./live-offer-policy";
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

// DATA-20260906-001 2층(완료정의[2]): 표시 가격은 min(live offers)만 붙는다 —
// live offer가 0개인 딜(스테일 캐시 최저가·BKI형 오퍼 공백)은 비노출이 기본.
export function isDealDisplayable(deal: Pick<MapDeal, "economy_min_total" | "business_min_total">) {
  return deal.economy_min_total != null || deal.business_min_total != null;
}


// UX-20260910-004(진단 (b)(c)): 기본 뷰가 현재 주차에 고정돼 주 후반으로 갈수록 live 도시가
// 얇아진다(실측 W37=7 vs W38=12·W39=14). 결과가 하한 미만일 때 인접 조건의 도시 수를 함께
// 계산해 "조건을 바꾸면 N개 도시" 제안으로 탐색을 이어준다 — 빈 상태+사유 정책의 보완일 뿐 대체가 아니다.
export const MIN_CITIES_FOR_SUGGESTION = 5;

const STAY_BUCKET_CODES: string[] = TRIP_BUCKETS.map((bucket) => bucket.code);

function adjacentWeekCode(week: string, offsetWeeks: number): string | null {
  const monday = weekStartDate(week);
  if (!monday) return null;
  monday.setUTCDate(monday.getUTCDate() + offsetWeeks * 7);
  return isoWeekCode(monday);
}

// 표시와 동일한 live-조인 의미론으로 인접 조건(±1주·다른 체류 버킷)의 도시 수를 잰다.
export async function countAdjacentMapCities(
  mapQuery: Pick<MapQuery, "origin" | "week" | "stay_bucket" | "traveler" | "region">,
  eligibleSourceKeys: Set<string>,
): Promise<import("../mock-market").MapViewAlternative[]> {
  const prevWeek = adjacentWeekCode(mapQuery.week, -1);
  const nextWeek = adjacentWeekCode(mapQuery.week, 1);
  const weeks = [...new Set([prevWeek, mapQuery.week, nextWeek].filter((week): week is string => Boolean(week)))];
  const { rows } = await pgQuery(`
    WITH live AS (
      SELECT DISTINCT o.origin_airport, o.destination_city_id, o.week, o.stay_bucket
      FROM offers o
      WHERE o.origin_airport = ANY($1::text[])
        AND o.traveler = $2
        AND o.week = ANY($3::text[])
        AND o.stay_bucket = ANY($4::text[])
        AND ${LIVE_OFFER_VISIBILITY_SQL}
        AND (
          LOWER(COALESCE(o.booking_source, '')) = ANY($5::text[])
          OR (
            LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
            AND LOWER(COALESCE(o.airline_code, '')) = ANY($5::text[])
          )
        )
    )
    SELECT d.week, d.stay_bucket, count(DISTINCT d.destination_city_id)::int AS cities
    FROM deals_current d
    JOIN live l ON l.origin_airport = d.origin
      AND l.destination_city_id = d.destination_city_id
      AND l.week = d.week
      AND l.stay_bucket = d.stay_bucket
    WHERE d.is_active = true
      AND d.origin = ANY($1::text[])
      AND d.traveler = $2
      AND GREATEST(COALESCE(d.economy_best_depart_date, '1970-01-01'), COALESCE(d.business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
    GROUP BY 1, 2
  `, [queryOrigins(mapQuery.origin), mapQuery.traveler, weeks, STAY_BUCKET_CODES, [...eligibleSourceKeys]]);

  const countFor = (week: string, bucket: string) =>
    rows.find((row) => row.week === week && row.stay_bucket === bucket)?.cities ?? 0;
  const bucketLabel = (bucket: string) => (TRIP_BUCKET_LABEL_BY_CODE as Map<string, string>).get(bucket) ?? bucket;

  const alternatives: import("../mock-market").MapViewAlternative[] = [];
  for (const [week, label] of [[prevWeek, "지난 주간"], [nextWeek, "다음 주간"]] as const) {
    if (week && week !== mapQuery.week) {
      const cities = countFor(week, mapQuery.stay_bucket);
      if (cities >= MIN_CITIES_FOR_SUGGESTION) alternatives.push({ kind: "week", week, label, cities });
    }
  }
  for (const bucket of STAY_BUCKET_CODES) {
    if (bucket !== mapQuery.stay_bucket) {
      const cities = countFor(mapQuery.week, bucket);
      if (cities >= MIN_CITIES_FOR_SUGGESTION) {
        alternatives.push({ kind: "stay", stay_bucket: bucket as MapQuery["stay_bucket"], label: bucketLabel(bucket), cities });
      }
    }
  }
  return alternatives.sort((left, right) => right.cities - left.cities);
}

export async function resolveMapDataFromPostgres(mapQuery: MapQuery, lastBatchAt: string, sourceFlags: string[]): Promise<MapData | null> {
  if (!postgresConfigured()) return null;
  if (mapQuery.stay_bucket === "ALL") return null;
  const eligibleSourceKeys = eligibleReadModelSourceKeys(sourceFlags);
  if (!eligibleSourceKeys.size) return null;

  // DATA-20260906-001 2층: 가격·대표 오퍼 열은 deals_current 캐시가 아니라 live offers의
  // 캐빈별 최저가(argmin)에서 온다. 캐시(deals_current.*)는 후보 딜 목록과 정렬 힌트만 제공한다.
  let sql = `
    WITH live_cabin AS (
      SELECT DISTINCT ON (o.origin_airport, o.destination_city_id, o.week, o.stay_bucket, o.traveler, LOWER(o.cabin_group))
        o.origin_airport AS origin, o.destination_city_id, o.week, o.stay_bucket, o.traveler,
        LOWER(o.cabin_group) AS cabin_group,
        COALESCE(o.normalized_total_krw, o.total_price) AS min_total_krw,
      o.airline_code AS representative_airline,
        LOWER(COALESCE(NULLIF(o.booking_source, ''), '')) AS representative_source,
        o.depart_date AS best_depart_date, o.return_date AS best_return_date,
        o.deep_link, o.last_seen_at, o.last_batch_at
      FROM offers o
      WHERE o.origin_airport = ANY($1::text[])
        AND o.week = $2
        AND o.traveler = $3
        AND o.stay_bucket = $4
        AND UPPER(o.cabin_group) IN ('ECONOMY', 'BUSINESS')
        AND ${LIVE_OFFER_VISIBILITY_SQL}
        AND (
          LOWER(COALESCE(o.booking_source, '')) = ANY($5::text[])
          OR (
            LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
            AND LOWER(COALESCE(o.airline_code, '')) = ANY($5::text[])
          )
        )
      ORDER BY o.origin_airport, o.destination_city_id, o.week, o.stay_bucket, o.traveler, LOWER(o.cabin_group),
        COALESCE(o.normalized_total_krw, o.total_price) ASC,
        o.stop_count ASC,
        COALESCE(o.duration_minutes, 99999) ASC,
        o.depart_date ASC
    )
    SELECT
      d.origin,
      d.destination_city_id,
      d.destination_display_name,
      d.country_code,
      d.region,
      d.latitude,
      d.longitude,
      eco.min_total_krw AS economy_min_total_krw,
      -- H4(2026-09-08 핫픽스): 할인률(deals_current 캐시)은 캐시 최저가와 live 최저가가 같은
      -- 세대일 때만 노출한다 — 캐시 할인 + live 가격의 혼합 표시는 거짓 근거가 된다.
      CASE WHEN d.economy_min_total_krw = eco.min_total_krw THEN d.economy_discount_pct END AS economy_discount_pct,
      d.economy_badge_type,
      CASE WHEN eco.min_total_krw IS NOT NULL THEN 'active' END AS economy_price_status,
      eco.best_depart_date AS economy_best_depart_date,
      eco.best_return_date AS economy_best_return_date,
      eco.representative_airline AS economy_representative_airline,
      eco.representative_source AS economy_representative_source,
      eco.deep_link AS economy_deep_link,
      eco.last_seen_at AS economy_last_seen_at,
      eco.last_batch_at AS economy_last_batch_at,
      biz.min_total_krw AS business_min_total_krw,
      CASE WHEN d.business_min_total_krw = biz.min_total_krw THEN d.business_discount_pct END AS business_discount_pct,
      d.business_badge_type,
      CASE WHEN biz.min_total_krw IS NOT NULL THEN 'active' END AS business_price_status,
      biz.best_depart_date AS business_best_depart_date,
      biz.best_return_date AS business_best_return_date,
      biz.representative_airline AS business_representative_airline,
      biz.representative_source AS business_representative_source,
      biz.deep_link AS business_deep_link,
      biz.last_seen_at AS business_last_seen_at,
      biz.last_batch_at AS business_last_batch_at,
      d.warning_flags,
      d.enabled_sources
    FROM deals_current d
    LEFT JOIN live_cabin eco ON eco.origin = d.origin
      AND eco.destination_city_id = d.destination_city_id
      AND eco.week = d.week
      AND eco.stay_bucket = d.stay_bucket
      AND eco.traveler = d.traveler
      AND eco.cabin_group = 'economy'
    LEFT JOIN live_cabin biz ON biz.origin = d.origin
      AND biz.destination_city_id = d.destination_city_id
      AND biz.week = d.week
      AND biz.stay_bucket = d.stay_bucket
      AND biz.traveler = d.traveler
      AND biz.cabin_group = 'business'
    WHERE d.origin = ANY($1::text[])
      AND d.week = $2
      AND d.traveler = $3
      AND d.stay_bucket = $4
      AND d.is_active = true
      AND GREATEST(COALESCE(d.economy_best_depart_date, '1970-01-01'), COALESCE(d.business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
  `;
  const params: unknown[] = [queryOrigins(mapQuery.origin), mapQuery.week, mapQuery.traveler, mapQuery.stay_bucket, [...eligibleSourceKeys]];

  if (mapQuery.region !== "ALL") {
    sql += ` AND d.region = $6`;
    params.push(mapQuery.region);
  }

  const { rows } = await pgQuery(sql, params);
  if (!rows.length) {
    // 0행도 제안은 계산한다(명시 주간 선택의 정직 빈 상태를 유지한 채 탐색을 이어준다).
    const alternatives = await countAdjacentMapCities(mapQuery, eligibleSourceKeys).catch(() => []);
    return { ...emptyMapDataForQuery(mapQuery), alternatives };
  }

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
      .filter(isDealDisplayable)
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

  // 도시 수 하한 미만(퇴화 뷰)일 때만 인접 조건 제안을 붙인다 — 추가 쿼리 비용도 이 경우에만 발생.
  const alternatives = deals.length > 0 && deals.length < MIN_CITIES_FOR_SUGGESTION
    ? await countAdjacentMapCities(mapQuery, eligibleSourceKeys).catch(() => [])
    : undefined;

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
    alternatives,
  };
}
