#!/usr/bin/env node
// DATA-20260906-001 2층 — 스테일 딜 전량 재계산 스윕(완료정의[2]).
//
// 문제: deals_current 재계산은 배치에 포함된 그룹만 갱신되므로, 피드에서 사라진 그룹의
// 캐시 최저가가 is_active=true로 남는다(2026-09-08 실측 611/989=62%, 하루 +74 가속).
// 읽기 경로는 이미 min(live offers)로 전환(map-query live 조인)돼 표시는 안전하지만,
// 캐시·is_active·배치 조인 비율의 건전성을 회복하려면 전량 재계산이 필요하다.
//
// 동작(기본 dry-run, --apply 시 실행 — 운영 데이터 전량 갱신이라 실행은 사람 승인):
//   1. 활성 딜을 청크(기본 200그룹)로 순회하며 live offers(공유 가드 lib/read-model/live-offer-policy)의
//      캐빈별 argmin을 계산한다.
//   2. live offer가 전원 없는 그룹은 is_active=false(비노출 전환, 재수집 시 배치가 재활성화).
//   3. live가 있는 그룹은 캐시 최저가·대표 오퍼 열을 live 값으로 재기록한다.
//   4. dry-run은 수치만 보고: 처리·비노출 전환·스테일 가격(캐시≠live) 그룹 수, 조인 비율 before/after.
import { pathToFileURL } from "node:url";

import pg from "pg";

import { collectorDatabaseUrl, measureDealOfferJoin } from "./ingest-collector-batch.mjs";
import { LIVE_OFFER_VISIBILITY_SQL, MIN_DEAL_OFFER_JOIN_RATIO } from "../lib/read-model/live-offer-policy.ts";

const { Client } = pg;

const COLUMNS = {
  economy: [
    "economy_min_total_krw",
    "economy_price_status",
    "economy_best_depart_date",
    "economy_best_return_date",
    "economy_representative_airline",
    "economy_representative_source",
    "economy_deep_link",
    "economy_last_seen_at",
    "economy_last_batch_at",
  ],
  business: [
    "business_min_total_krw",
    "business_price_status",
    "business_best_depart_date",
    "business_best_return_date",
    "business_representative_airline",
    "business_representative_source",
    "business_deep_link",
    "business_last_seen_at",
    "business_last_batch_at",
  ],
};

function cabinPayload(liveRow, prefix) {
  if (!liveRow) {
    return Object.fromEntries(COLUMNS[prefix].map((column) => [column, null]));
  }
  return {
    [`${prefix}_min_total_krw`]: Number(liveRow.min_total_krw),
    [`${prefix}_price_status`]: "active",
    [`${prefix}_best_depart_date`]: liveRow.best_depart_date,
    [`${prefix}_best_return_date`]: liveRow.best_return_date,
    [`${prefix}_representative_airline`]: liveRow.representative_airline,
    [`${prefix}_representative_source`]: liveRow.representative_source,
    [`${prefix}_deep_link`]: liveRow.deep_link,
    [`${prefix}_last_seen_at`]: liveRow.last_seen_at,
    [`${prefix}_last_batch_at`]: liveRow.last_batch_at,
  };
}

async function fetchChunk(client, lastDealId, chunkSize) {
  const { rows } = await client.query(`
    SELECT deal_id, origin, destination_city_id, week, stay_bucket, traveler,
      economy_min_total_krw, business_min_total_krw
    FROM deals_current
    WHERE is_active = true AND deal_id > $1
    ORDER BY deal_id
    LIMIT $2
  `, [lastDealId, chunkSize]);
  return rows;
}

async function fetchLiveCabins(client, chunkRows) {
  if (!chunkRows.length) return new Map();
  const { rows } = await client.query(`
    WITH chunk AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        deal_id text, origin text, destination_city_id text, week text, stay_bucket text, traveler text
      )
    ),
    live_cabin AS (
      SELECT DISTINCT ON (c.deal_id, LOWER(o.cabin_group))
        c.deal_id, LOWER(o.cabin_group) AS cabin_group,
        COALESCE(o.normalized_total_krw, o.total_price) AS min_total_krw,
        o.depart_date AS best_depart_date, o.return_date AS best_return_date,
        o.airline_code AS representative_airline,
        LOWER(COALESCE(NULLIF(o.booking_source, ''), '')) AS representative_source,
        o.deep_link, o.last_seen_at, o.last_batch_at
      FROM chunk c
      JOIN offers o ON o.origin_airport = c.origin
        AND o.destination_city_id = c.destination_city_id
        AND o.week = c.week
        AND o.stay_bucket = c.stay_bucket
        AND o.traveler = c.traveler
      WHERE UPPER(o.cabin_group) IN ('ECONOMY', 'BUSINESS')
        AND ${LIVE_OFFER_VISIBILITY_SQL}
      ORDER BY c.deal_id, LOWER(o.cabin_group),
        COALESCE(o.normalized_total_krw, o.total_price) ASC,
        o.stop_count ASC,
        COALESCE(o.duration_minutes, 99999) ASC,
        o.depart_date ASC
    )
    SELECT deal_id, cabin_group, min_total_krw,
      best_depart_date, best_return_date, representative_airline, representative_source,
      deep_link, last_seen_at, last_batch_at
    FROM live_cabin
  `, [JSON.stringify(chunkRows.map(({ deal_id, origin, destination_city_id, week, stay_bucket, traveler }) => ({
    deal_id, origin, destination_city_id, week, stay_bucket, traveler,
  })))]);

  const byDeal = new Map();
  for (const row of rows) {
    const entry = byDeal.get(row.deal_id) ?? {};
    entry[row.cabin_group] = row;
    byDeal.set(row.deal_id, entry);
  }
  return byDeal;
}

async function applyChunk(client, planRows) {
  if (!planRows.length) return 0;
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        deal_id text, is_active boolean,
        economy jsonb, business jsonb
      )
    )
    UPDATE deals_current d SET
      economy_min_total_krw = (economy->>'economy_min_total_krw')::numeric,
      economy_price_status = economy->>'economy_price_status',
      economy_best_depart_date = (economy->>'economy_best_depart_date')::date,
      economy_best_return_date = (economy->>'economy_best_return_date')::date,
      economy_representative_airline = economy->>'economy_representative_airline',
      economy_representative_source = economy->>'economy_representative_source',
      economy_deep_link = economy->>'economy_deep_link',
      economy_last_seen_at = (economy->>'economy_last_seen_at')::timestamptz,
      economy_last_batch_at = (economy->>'economy_last_batch_at')::timestamptz,
      business_min_total_krw = (business->>'business_min_total_krw')::numeric,
      business_price_status = business->>'business_price_status',
      business_best_depart_date = (business->>'business_best_depart_date')::date,
      business_best_return_date = (business->>'business_best_return_date')::date,
      business_representative_airline = business->>'business_representative_airline',
      business_representative_source = business->>'business_representative_source',
      business_deep_link = business->>'business_deep_link',
      business_last_seen_at = (business->>'business_last_seen_at')::timestamptz,
      business_last_batch_at = (business->>'business_last_batch_at')::timestamptz,
      is_active = input.is_active
    FROM input
    WHERE d.deal_id = input.deal_id
  `, [JSON.stringify(planRows)]);
  return planRows.length;
}

function parseArgs(argv) {
  const args = { apply: false, chunkSize: 200, databaseUrl: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--chunk-size") {
      args.chunkSize = Number(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.chunkSize) || args.chunkSize <= 0) throw new Error("--chunk-size must be a positive integer");
  return args;
}

export async function sweepStaleDeals(options = {}) {
  const apply = options.apply ?? false;
  const chunkSize = options.chunkSize ?? 200;
  const client = new Client({ connectionString: options.connectionString ?? collectorDatabaseUrl(options) });
  await client.connect();

  const totals = {
    groups_scanned: 0,
    groups_with_live_offers: 0,
    groups_to_deactivate: 0,
    stale_price_groups: 0,
    cabins_refreshed: 0,
  };
  try {
    let lastDealId = "";
    for (;;) {
      const chunkRows = await fetchChunk(client, lastDealId, chunkSize);
      if (!chunkRows.length) break;
      lastDealId = chunkRows[chunkRows.length - 1].deal_id;

      const liveByDeal = await fetchLiveCabins(client, chunkRows);
      const planRows = [];
      for (const row of chunkRows) {
        const live = liveByDeal.get(row.deal_id) ?? {};
        const hasLive = Boolean(live.economy || live.business);
        totals.groups_scanned += 1;
        if (hasLive) totals.groups_with_live_offers += 1;
        else totals.groups_to_deactivate += 1;

        const stalePrice =
          (live.economy && row.economy_min_total_krw !== null && Number(row.economy_min_total_krw) !== Number(live.economy.min_total_krw)) ||
          (live.business && row.business_min_total_krw !== null && Number(row.business_min_total_krw) !== Number(live.business.min_total_krw));
        if (stalePrice) totals.stale_price_groups += 1;
        if (live.economy) totals.cabins_refreshed += 1;
        if (live.business) totals.cabins_refreshed += 1;

        planRows.push({
          deal_id: row.deal_id,
          is_active: hasLive,
          economy: cabinPayload(live.economy, "economy"),
          business: cabinPayload(live.business, "business"),
        });
      }

      if (apply) await applyChunk(client, planRows);
    }

    // H4(2026-09-08 핫픽스): apply 후 게이트와 동일 소스로 재측정해 batch_state.last_batch의
    // deal_join_ratio 키에 병합 기록한다 — 스윕만 하고 ratio가 없으면 게이트가 영구 503이다.
    // 기존 필드(status·last_batch_at 등)는 보존한다(워치독·source-health가 함께 읽는다).
    let ratioRecorded = null;
    if (apply) {
      const dealJoin = await measureDealOfferJoin(client);
      const { rows } = await client.query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1");
      const merged = {
        ...(rows[0]?.data ?? {}),
        deal_join_ratio: dealJoin.deal_offer_join_ratio,
        deal_join_ratio_active_deals: dealJoin.active_deals,
        deal_join_ratio_with_live_offers: dealJoin.active_deals_with_live_offers,
        deal_join_ratio_below_min: dealJoin.below_threshold,
        deal_join_ratio_measured_at: new Date().toISOString(),
        deal_join_ratio_source: "sweep",
      };
      await client.query(`
        INSERT INTO batch_state (key, data)
        VALUES ('last_batch', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data
      `, [JSON.stringify(merged)]);
      ratioRecorded = dealJoin;
    }

    const activeAfter = totals.groups_with_live_offers;
    return {
      mode: apply ? "apply" : "dry_run",
      ...totals,
      join_ratio_before: totals.groups_scanned > 0
        ? Number((totals.groups_with_live_offers / totals.groups_scanned).toFixed(4))
        : null,
      join_ratio_after: ratioRecorded ? ratioRecorded.deal_offer_join_ratio : null,
      join_ratio_after_projection: activeAfter > 0 ? 1 : null,
      remaining_stale_pct_after_projection: 0,
      min_batch_ratio: MIN_DEAL_OFFER_JOIN_RATIO,
      ratio_key: "batch_state.last_batch.deal_join_ratio",
      note: apply
        ? "캐시 최저가·is_active가 live offers 값으로 재기록되고 조인 비율이 batch_state에 기록되었다"
        : "dry-run — 수치만 보고, 데이터 변경 없음. 실행은 --apply (운영 전량 갱신, 사람 승인 대상)",
    };
  } finally {
    await client.end();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  sweepStaleDeals({
    apply: args.apply,
    chunkSize: args.chunkSize,
    connectionString: args.databaseUrl || undefined,
  })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((err) => {
      console.error("Sweep failed.");
      console.error(err);
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
