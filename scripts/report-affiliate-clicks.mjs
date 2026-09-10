#!/usr/bin/env node
// UX-20260910-005: 제휴 클릭 최소 리포트 — sub_id별 클릭/예약/수익(최근 14일).
// 노출 수 계측(애널리틱스)이 없어 노출→클릭 전환율은 산출 불가 — 클릭 수 보고가 최소 형태다.
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

export async function reportAffiliateClicks(options = {}) {
  const client = new Client({ connectionString: options.connectionString ?? process.env.DATABASE_READ_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: bySub } = await client.query(`
      SELECT sub_id,
        sum(clicks)::int AS clicks,
        sum(bookings)::int AS bookings,
        sum(paid_bookings)::int AS paid_bookings,
        sum(profit_krw)::numeric AS profit_krw,
        max(stat_date)::text AS last_active
      FROM affiliate_click_stats
      WHERE stat_date > CURRENT_DATE - interval '14 days'
      GROUP BY 1 ORDER BY 2 DESC
    `);
    const { rows: total } = await client.query(`
      SELECT count(DISTINCT stat_date)::int AS days, sum(clicks)::int AS clicks, sum(bookings)::int AS bookings,
        sum(profit_krw)::numeric AS profit_krw, max(stat_date)::text AS latest
      FROM affiliate_click_stats WHERE stat_date > CURRENT_DATE - interval '14 days'
    `);
    return { window_days: 14, by_sub_id: bySub, total: total[0] ?? null };
  } finally {
    await client.end();
  }
}

function main() {
  reportAffiliateClicks()
    .then((report) => {
      console.log(`제휴 클릭 리포트(최근 ${report.window_days}일) — 노출 미계측으로 전환율 대신 클릭 수 보고`);
      if (report.total) {
        console.log(`합계: 클릭 ${report.total.clicks} · 예약 ${report.total.bookings} · 유료예약 ${report.total.paid_bookings} · 수익 ₩${report.total.profit_krw} · 최근 활동일 ${report.total.latest}(${report.total.days}일분)`);
      }
      for (const row of report.by_sub_id) {
        console.log(`  ${row.sub_id.padEnd(28)} 클릭 ${String(row.clicks).padStart(4)} · 예약 ${row.bookings} · 수익 ₩${row.profit_krw} · 최근 ${row.last_active}`);
      }
      if (!report.by_sub_id.length) console.log("  (데이터 없음 — collect-tp-click-stats 실행 이력 확인)");
    })
    .catch((error) => {
      console.error("report failed:", error);
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
