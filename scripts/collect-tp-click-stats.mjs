#!/usr/bin/env node
// UX-20260910-005: 제휴 클릭 회수 잡 — Travelpayouts 통계 API(기존 보유 토큰, 추가 계정 불필요).
//
// API(지표 문서화 — 2026-09-10 리서치):
//   GET https://api.travelpayouts.com/v2/statistics/sales
//     ?group_by=date_marker&month=<YYYY-MM-DD(해당 월 아무 날짜)>&currency=krw&token=<API_TOKEN>
//   응답: data.sales = { [날짜]: { [sub_id]: { flights: {visitors, searches, clicks,
//     paid_clicks, paid_clicks_profit, bookings, paid_bookings, paid_bookings_profit,
//     pending_bookings_profit}, hotels: {…동일…} } } }
//   → 클릭 외 지표(예약·수익)도 함께 제공되므로 전부 적재한다(스키마 참조).
//   참고: 이 엔드포인트는 TP 문서상 deprecated 표기이나 (date×sub_id) 클릭+예약+수익을
//   한 번에 주는 유일 경로다 — 신규 bookings 전용 API로 이관은 월 리서치가 감시한다.
//
// 동작: 전일(기본) 날짜의 sub_id별 지표를 affiliate_click_stats에 upsert.
//   --dry-run     응답 파싱·집계만 출력(적재 없음)
//   --date YYYY-MM-DD  대상 날짜(기본 전일 KST)
// 실패 정책: 토큰 미설정·API 오류·빈 응답 모두 경고 로그 + exit 0(allow_empty 준용 —
//   배치 전체를 실패시키지 않는다). 데이터 부재는 리포트(report-affiliate-clicks)가 노출.
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;
const TP_STATS_URL = "https://api.travelpayouts.com/v2/statistics/sales";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDateOnly(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function targetStatDate(now = new Date(), explicitDate) {
  if (explicitDate) return explicitDate;
  return kstDateOnly(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export function parseTpSalesResponse(payload, statDate) {
  // data.sales[날짜][sub_id] → 지표 합계(flights+hotels). 스키마 이탈은 빈 배열(soft-fail).
  const sales = payload?.data?.sales;
  if (!sales || typeof sales !== "object") return [];
  const bySubId = sales[statDate] ?? {};
  const rows = [];
  for (const [subId, markers] of Object.entries(bySubId)) {
    const sum = (field) =>
      Number(markets(markers).reduce((acc, m) => acc + Number(m?.[field] ?? 0), 0));
    const profit = (field) =>
      Number(markets(markers).reduce((acc, m) => acc + Number(m?.[field] ?? 0), 0));
    rows.push({
      stat_date: statDate,
      sub_id: subId,
      visitors: sum("visitors"),
      searches: sum("searches"),
      clicks: sum("clicks"),
      paid_clicks: sum("paid_clicks"),
      bookings: sum("bookings"),
      paid_bookings: sum("paid_bookings"),
      profit_krw: profit("paid_clicks_profit") + profit("paid_bookings_profit") + profit("pending_bookings_profit"),
    });
  }
  return rows;
}

function markets(markers) {
  if (!markers || typeof markers !== "object") return [];
  return ["flights", "hotels"].map((key) => markers[key]).filter(Boolean);
}

async function fetchTpSales({ token, month, statDate, fetchImpl }) {
  const doFetch = fetchImpl ?? ((url, init) => fetch(url, init));
  const url = `${TP_STATS_URL}?group_by=date_marker&month=${month}&currency=krw&token=${encodeURIComponent(token)}`;
  const response = await doFetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`TP statistics API ${response.status}`);
  const payload = await response.json();
  if (payload?.success === false) throw new Error(`TP statistics API error: ${JSON.stringify(payload?.error ?? payload).slice(0, 200)}`);
  return parseTpSalesResponse(payload, statDate);
}

export async function collectTpClickStats(options = {}) {
  const now = options.now ?? new Date();
  const statDate = targetStatDate(now, options.date);
  const token = options.token ?? process.env.TRAVELPAYOUTS_API_KEY ?? "";
  if (!token) {
    console.warn(`[collect-tp-click-stats] TRAVELPAYOUTS_API_KEY 미설정 — 스킵(allow_empty 준용). 대상 날짜 ${statDate}`);
    return { status: "skipped_no_token", stat_date: statDate, rows: 0 };
  }
  const month = `${statDate.slice(0, 7)}-01`;
  let rows;
  try {
    rows = await fetchTpSales({ token, month, statDate, fetchImpl: options.fetchImpl });
  } catch (error) {
    console.warn(`[collect-tp-click-stats] API 실패 — 배치를 실패시키지 않는다: ${error?.message ?? error}`);
    return { status: "api_failed", stat_date: statDate, rows: 0, error: String(error?.message ?? error) };
  }
  if (!rows.length) {
    console.warn(`[collect-tp-click-stats] ${statDate} 지표 0건(제휴 트래픽 없음 또는 미집계) — 정상 빈 결과.`);
    return { status: "empty", stat_date: statDate, rows: 0 };
  }
  if (options.dryRun) {
    return { status: "dry_run", stat_date: statDate, rows: rows.length, sample: rows.slice(0, 5) };
  }
  const client = new Client({ connectionString: options.connectionString ?? process.env.DATABASE_INGEST_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO affiliate_click_stats (stat_date, sub_id, visitors, searches, clicks, paid_clicks, bookings, paid_bookings, profit_krw, fetched_at)
      SELECT (r->>'stat_date')::date, r->>'sub_id',
        (r->>'visitors')::int, (r->>'searches')::int, (r->>'clicks')::int, (r->>'paid_clicks')::int,
        (r->>'bookings')::int, (r->>'paid_bookings')::int, (r->>'profit_krw')::numeric, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS r(stat_date text, sub_id text, visitors int, searches int, clicks int, paid_clicks int, bookings int, paid_bookings int, profit_krw numeric)
      ON CONFLICT (stat_date, sub_id) DO UPDATE SET
        visitors = EXCLUDED.visitors, searches = EXCLUDED.searches, clicks = EXCLUDED.clicks,
        paid_clicks = EXCLUDED.paid_clicks, bookings = EXCLUDED.bookings, paid_bookings = EXCLUDED.paid_bookings,
        profit_krw = EXCLUDED.profit_krw, fetched_at = NOW()
    `, [JSON.stringify(rows)]);
  } finally {
    await client.end();
  }
  return { status: "stored", stat_date: statDate, rows: rows.length };
}

function parseArgs(argv) {
  const args = { dryRun: false, date: "", connectionString: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--date") { args.date = argv[index + 1] ?? ""; index += 1; }
    else if (arg === "--database-url") { args.connectionString = argv[index + 1] ?? ""; index += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  collectTpClickStats(args)
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      // 최후의 방어: 예상 못한 오류조차 배치를 죽이지 않는다(과업 지시).
      console.warn("[collect-tp-click-stats] unexpected failure — swallowed:", error);
      process.exit(0);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
