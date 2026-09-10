#!/usr/bin/env node
// UX-20260910-005: 제휴 클릭 회수 잡 — Travelpayouts 통계 API(기존 보유 토큰, 추가 계정 불필요).
//
// API(2026-09-11 마이그레이션 — 구 v2 statistics sales 엔드포인트는 404로 폐기됨, 첫 스케줄 실행 실측):
//   GET  https://api.travelpayouts.com/statistics/v1/get_fields_list?data_type=aggregated
//   POST https://api.travelpayouts.com/statistics/v1/execute_query
//     headers: { X-Access-Token: <API_TOKEN> }
//     body: { fields: [...aggregated 지표], filters: [{field:"date",op:"ge/le",value}],
//             group: ["sub_id"], offset: 0, limit: 10000 }
//   응답: data = [{ group: { sub_id }, redirects_count, inits_count, searches_count,
//     paid_actions_count, processing_actions_count, cancelled_actions_count,
//     paid_profit_krw_sum, processing_profit_krw_sum }, ...]
//   필드 이름은 문서 예시가 표기를 달리하는 경우가 있어(get_fields_list로 확인 후 쿼리 구성이
//   공식 권장) 후보 우선순위로 발견한다 — 문서만으로 확정하지 않는 자기기술 설계.
//   출처: support.travelpayouts.com "API of affiliate programs booking statistics"
//   (구 엔드포인트 폐기 공지: "API of affiliate booking, balance and payment (deprecated)").
//
// 동작: 전일(기본) 날짜의 sub_id별 지표를 affiliate_click_stats에 upsert.
//   --dry-run     응답 파싱·집계만 출력(적재 없음)
//   --date YYYY-MM-DD  대상 날짜(기본 전일 KST)
// 실패 정책: 토큰 미설정·API 오류·빈 응답 모두 경고 로그 + exit 0(allow_empty 준용 —
//   배치 전체를 실패시키지 않는다). 데이터 부재는 리포트(report-affiliate-clicks)가 노출.
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;
const TP_FIELDS_URL = "https://api.travelpayouts.com/statistics/v1/get_fields_list?data_type=aggregated";
const TP_QUERY_URL = "https://api.travelpayouts.com/statistics/v1/execute_query";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDateOnly(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function targetStatDate(now = new Date(), explicitDate) {
  if (explicitDate) return explicitDate;
  return kstDateOnly(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

// 지표별 필드 후보(우선순위) — 발견된 필드 목록과 교집합으로 확정한다.
export const TP_METRIC_CANDIDATES = {
  clicks: ["redirects_count", "clicks_count", "clicks"],
  visitors: ["inits_count", "init_count", "visitors_count", "visitors"],
  searches: ["searches_count", "searches"],
  paidBookings: ["paid_actions_count"],
  bookingsComponents: ["processing_actions_count", "cancelled_actions_count"],
  profitKrw: ["paid_profit_krw_sum", "processing_profit_krw_sum"],
};

// available 이 비면(필드 목록 파식 실패) 문서 표준 이름(각 후보 첫째)을 그대로 시도한다.
export function buildTpFieldSelection(availableFieldNames) {
  const available = new Set(availableFieldNames ?? []);
  const has = (field) => available.size === 0 || available.has(field);
  // 단일 지표는 우선순위 첫 적중, 합산 지표(예약·수익 성분)는 가용 전부를 쓴다.
  const pickOne = (candidates) => candidates.find((field) => has(field)) ?? null;
  const pickAll = (candidates) => candidates.filter((field) => has(field));
  const picked = {
    clicks: pickOne(TP_METRIC_CANDIDATES.clicks),
    visitors: pickOne(TP_METRIC_CANDIDATES.visitors),
    searches: pickOne(TP_METRIC_CANDIDATES.searches),
    paidBookings: pickOne(TP_METRIC_CANDIDATES.paidBookings),
    bookingsComponents: pickAll(TP_METRIC_CANDIDATES.bookingsComponents),
    profitFields: pickAll(TP_METRIC_CANDIDATES.profitKrw),
  };
  return {
    queryFields: [...new Set([
      picked.clicks, picked.visitors, picked.searches, picked.paidBookings,
      ...picked.bookingsComponents, ...picked.profitFields,
    ].filter(Boolean))],
    profitLimited: picked.profitFields.length === 0,
    picked,
  };
}

// get_fields_list 응답의 실제 형태는 문서와 다를 수 있다(1차 실측: 파싱 0건·폴백 이름으로 400).
// 배열 직계 문자열과 {field_name}|{name,type} 설명자만 수집한다 — 객체 값의 열거 문자열 오염 방지.
export function extractTpFieldNames(payload) {
  const names = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === "string") names.add(item);
        else visit(item);
      }
    } else if (node && typeof node === "object") {
      if (typeof node.field_name === "string") names.add(node.field_name);
      else if (typeof node.name === "string" && typeof node.type === "string") names.add(node.name);
      Object.values(node).forEach(visit);
    }
  };
  visit(payload?.data ?? payload);
  return [...names];
}

export function parseTpStatsRows(payload, statDate, selection) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const { picked } = selection;
  const num = (row, field) => (field ? Math.max(0, Number(row?.[field]) || 0) : 0);
  return rows.map((row) => ({
    stat_date: statDate,
    sub_id: row?.group?.sub_id ?? row?.sub_id ?? "",
    // 신규 API의 aggregated 세트에 유료클릭 구분 지표가 없다(0 적재) — 필요 시
    // action_type=paid_click 원시 쿼리가 업그레이드 경로다.
    paid_clicks: 0,
    visitors: num(row, picked.visitors),
    searches: num(row, picked.searches),
    clicks: num(row, picked.clicks),
    paid_bookings: num(row, picked.paidBookings),
    bookings: num(row, picked.paidBookings)
      + picked.bookingsComponents.reduce((acc, field) => acc + num(row, field), 0),
    profit_krw: picked.profitFields.reduce((acc, field) => acc + num(row, field), 0),
  }));
}

async function fetchTpStats({ token, statDate, fetchImpl }) {
  const doFetch = fetchImpl ?? ((url, init) => fetch(url, init));
  const headers = { "X-Access-Token": token, Accept: "application/json" };
  const errorBody = async (res) => {
    if (typeof res?.text !== "function") return "";
    return (await res.text().catch(() => "")).slice(0, 300);
  };

  const fieldsRes = await doFetch(TP_FIELDS_URL, { headers, signal: AbortSignal.timeout(20000) });
  if (!fieldsRes.ok) throw new Error(`TP statistics fields API ${fieldsRes.status}: ${await errorBody(fieldsRes)}`);
  const fieldsPayload = await fieldsRes.json();
  const available = extractTpFieldNames(fieldsPayload);
  const selection = buildTpFieldSelection(available);
  // 진단: 필드 발견 결과를 남긴다(0건이면 원형 형태도 — 다음 반복의 단서).
  if (available.length === 0) {
    console.warn(`[collect-tp-click-stats] fields_discovered=0 raw=${JSON.stringify(fieldsPayload).slice(0, 400)}`);
  } else {
    console.warn(`[collect-tp-click-stats] fields_discovered=${available.length} selection=${JSON.stringify(selection.queryFields)}`);
  }

  const queryRes = await doFetch(TP_QUERY_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      // 문서 예시 형태: 그룹 필드(sub_id)도 fields에 포함한다.
      fields: ["sub_id", ...selection.queryFields],
      filters: [
        { field: "date", op: "ge", value: statDate },
        { field: "date", op: "le", value: statDate },
      ],
      group: ["sub_id"],
      offset: 0,
      limit: 10000,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!queryRes.ok) throw new Error(`TP statistics query API ${queryRes.status}: ${await errorBody(queryRes)}`);
  const payload = await queryRes.json();
  return {
    rows: parseTpStatsRows(payload, statDate, selection),
    fieldsUsed: selection.queryFields,
    profitCurrencyLimited: selection.profitLimited,
  };
}

export async function collectTpClickStats(options = {}) {
  const now = options.now ?? new Date();
  const statDate = targetStatDate(now, options.date);
  const token = options.token ?? process.env.TRAVELPAYOUTS_API_KEY ?? "";
  if (!token) {
    console.warn(`[collect-tp-click-stats] TRAVELPAYOUTS_API_KEY 미설정 — 스킵(allow_empty 준용). 대상 날짜 ${statDate}`);
    return { status: "skipped_no_token", stat_date: statDate, rows: 0 };
  }
  let fetched;
  try {
    fetched = await fetchTpStats({ token, statDate, fetchImpl: options.fetchImpl });
  } catch (error) {
    console.warn(`[collect-tp-click-stats] API 실패 — 배치를 실패시키지 않는다: ${error?.message ?? error}`);
    return { status: "api_failed", stat_date: statDate, rows: 0, error: String(error?.message ?? error) };
  }
  const rows = fetched.rows;
  if (!rows.length) {
    console.warn(`[collect-tp-click-stats] ${statDate} 지표 0건(제휴 트래픽 없음 또는 미집계) — 정상 빈 결과.`);
    return { status: "empty", stat_date: statDate, rows: 0, fields_used: fetched.fieldsUsed };
  }
  if (options.dryRun) {
    return { status: "dry_run", stat_date: statDate, rows: rows.length, sample: rows.slice(0, 5), fields_used: fetched.fieldsUsed, profit_currency_limited: fetched.profitCurrencyLimited };
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
  return { status: "stored", stat_date: statDate, rows: rows.length, fields_used: fetched.fieldsUsed, profit_currency_limited: fetched.profitCurrencyLimited };
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
