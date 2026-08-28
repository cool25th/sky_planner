import { pathToFileURL } from "node:url";

import pg from "pg";

import { collectorDatabaseUrl } from "./ingest-collector-batch.mjs";

const { Client } = pg;

const HISTORY_KEY = "price_baseline";
const KEEP_DAYS = 30;
const MIN_SAMPLE_DAYS = 3;

// RECO-20260828-001: 노선(출발지|목적지|주간|체류버킷|traveler)의 일별 최저가 히스토리를
// batch_state에 축적하고, 30일 rolling 평균 대비 절감률을 deals_current.discount_pct에 기록한다.
// sample < MIN_SAMPLE_DAYS면 null(근거 없는 주장 금지) — 히스토리는 하루 1포인트씩만 쌓인다.

export function routeKeyFromDeal(deal) {
  return [deal.origin, deal.destination_city_id, deal.week, deal.stay_bucket, deal.traveler].join("|");
}

export function minOrNull(values) {
  const numeric = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  return numeric.length ? Math.min(...numeric) : null;
}

export function mergeDailyHistory(history, todayIso, routeMins, keepDays = KEEP_DAYS) {
  const days = { ...(history?.days ?? {}) };
  days[todayIso] = routeMins;
  const cutoff = new Date(`${todayIso}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  for (const day of Object.keys(days)) {
    if (day < cutoffIso) delete days[day];
  }
  return { days };
}

export function computeRouteBaseline(dayEntries) {
  const economyValues = [];
  const businessValues = [];
  for (const entry of dayEntries) {
    if (entry?.economy !== null && entry?.economy !== undefined) economyValues.push(Number(entry.economy));
    if (entry?.business !== null && entry?.business !== undefined) businessValues.push(Number(entry.business));
  }
  const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    sample_days: economyValues.length,
    avg_economy: average(economyValues),
    min_economy: economyValues.length ? Math.min(...economyValues) : null,
    avg_business: average(businessValues),
    sample_days_business: businessValues.length,
  };
}

export function discountPctFromBaseline(todayPrice, baseline, minSampleDays = MIN_SAMPLE_DAYS) {
  if (todayPrice === null || todayPrice === undefined) return null;
  if (baseline.sample_days < minSampleDays) return null;
  const avg = baseline.avg_economy;
  if (!avg || avg <= 0) return null;
  const today = Number(todayPrice);
  if (!Number.isFinite(today) || today >= avg) return null;
  return Math.round(((avg - today) / avg) * 100);
}

function discountPctBusiness(todayPrice, baseline, minSampleDays = MIN_SAMPLE_DAYS) {
  if (todayPrice === null || todayPrice === undefined) return null;
  if (baseline.sample_days_business < minSampleDays) return null;
  const avg = baseline.avg_business;
  if (!avg || avg <= 0) return null;
  const today = Number(todayPrice);
  if (!Number.isFinite(today) || today >= avg) return null;
  return Math.round(((avg - today) / avg) * 100);
}

export async function updatePriceBaselines(options = {}) {
  const connectionString = options.connectionString ?? collectorDatabaseUrl({ env: process.env });
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows: dealRows } = await client.query(`
      SELECT origin, destination_city_id, week, stay_bucket, traveler,
             economy_min_total_krw, business_min_total_krw
      FROM deals_current
      WHERE is_active = true
    `);

    const routeMins = {};
    for (const deal of dealRows) {
      const key = routeKeyFromDeal(deal);
      const current = routeMins[key] ?? { economy: null, business: null };
      current.economy = minOrNull([current.economy, deal.economy_min_total_krw]);
      current.business = minOrNull([current.business, deal.business_min_total_krw]);
      routeMins[key] = current;
    }

    const { rows: stateRows } = await client.query("SELECT data FROM batch_state WHERE key = $1", [HISTORY_KEY]);
    const history = mergeDailyHistory(stateRows[0]?.data, todayIso, routeMins);
    await client.query(`
      INSERT INTO batch_state (key, data)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data
    `, [HISTORY_KEY, JSON.stringify(history)]);

    let discountsSet = 0;
    let routesTracked = 0;
    for (const [key, mins] of Object.entries(routeMins)) {
      const [origin, destination, week, stayBucket, traveler] = key.split("|");
      const dayEntries = Object.values(history.days).map((day) => day[key]).filter(Boolean);
      const baseline = computeRouteBaseline(dayEntries);
      routesTracked += 1;
      const economyPct = discountPctFromBaseline(mins.economy, baseline);
      const businessPct = discountPctBusiness(mins.business, baseline);
      if (economyPct !== null || businessPct !== null) {
        await client.query(`
          UPDATE deals_current
          SET economy_discount_pct = $1, business_discount_pct = $2
          WHERE origin = $3 AND destination_city_id = $4 AND week = $5
            AND stay_bucket = $6 AND traveler = $7 AND is_active = true
        `, [economyPct, businessPct, origin, destination, week, stayBucket, traveler]);
        discountsSet += 1;
      }
    }

    return {
      status: "updated",
      date: todayIso,
      routes_tracked: routesTracked,
      history_days: Object.keys(history.days).length,
      discounts_set: discountsSet,
      min_sample_days: MIN_SAMPLE_DAYS,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Updates batch_state price_baseline history and deals_current discount_pct from rolling route averages.");
    return;
  }
  console.log(JSON.stringify(await updatePriceBaselines(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Price baseline update failed.");
    console.error(err);
    process.exit(1);
  });
}
