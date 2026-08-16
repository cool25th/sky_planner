import assert from "node:assert/strict";

import pg from "pg";

import {
  SOURCE_POLICY_CATALOG,
  eligibleBookingSourceKeys,
  enabledSourceFlagsFromEnv,
  filterHealthySourceFlags,
  isOfferSourceEligible,
  sourceMaxStaleHoursFromEnv,
} from "../lib/source-policy.ts";

const { Client } = pg;

const DEFAULT_DATABASE_URL = "postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner";
const REQUIRED_TABLES = ["places", "offers", "deals_current", "source_health", "batch_state"];

function databaseUrl() {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

async function requireTables(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const tableNames = new Set(rows.map((row) => String(row.table_name)));
  for (const tableName of REQUIRED_TABLES) {
    assert.ok(tableNames.has(tableName), `missing required table: ${tableName}`);
  }
}

async function resolvedSourceFlags(client) {
  const envFlags = enabledSourceFlagsFromEnv();
  assert.ok(envFlags.length > 0, "at least one source flag must be enabled for DB smoke");

  const { rows } = await client.query(
    `
      SELECT source_id, is_paused, enabled_by_flag, circuit_breaker_open, consecutive_failures, last_success_at
      FROM source_health
      WHERE source_id = ANY($1::text[])
    `,
    [envFlags],
  );
  return filterHealthySourceFlags(envFlags, rows, new Date(), sourceMaxStaleHoursFromEnv());
}

function offerPolicyShape(row) {
  return {
    source_id: String(row.booking_source ?? ""),
    source_name: String(row.booking_source ?? ""),
    airline_code: String(row.airline_code ?? ""),
    source_type: String(row.source_type ?? ""),
  };
}

async function searchJapanOffers(client, sourceFlags, limit = 200) {
  const eligibleKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  if (!eligibleKeys.length) return [];

  const { rows } = await client.query(
    `
      WITH ranked_offers AS (
        SELECT
          offer_id,
          destination_city_id,
          booking_source,
          source_type,
          airline_code,
          cabin_group,
          total_price,
          normalized_total_krw,
          stop_count,
          duration_minutes,
          depart_date,
          return_date,
          stay_nights,
          ROW_NUMBER() OVER (
            PARTITION BY destination_city_id
            ORDER BY
              COALESCE(normalized_total_krw, total_price) ASC,
              CASE WHEN stop_count = 0 THEN 0 ELSE 1 END ASC,
              COALESCE(duration_minutes, 99999) ASC,
              depart_date ASC
          ) AS destination_rank
        FROM offers
        WHERE origin_airport = $1
          AND destination_city_id = ANY($2::text[])
          AND traveler = $3
          AND is_active = true
          AND COALESCE(bookability_status, 'available') <> 'sold_out'
          AND COALESCE(price_status, 'active') <> 'sold_out'
          AND COALESCE(price_anomaly_status, 'normal') = 'normal'
          AND COALESCE(quality_bucket, 'preferred') <> 'excluded'
          AND stay_nights BETWEEN $4 AND $5
          AND (
            LOWER(COALESCE(booking_source, '')) = ANY($6::text[])
            OR (
              LOWER(COALESCE(source_type, '')) <> 'meta_search'
              AND LOWER(COALESCE(airline_code, '')) = ANY($6::text[])
            )
          )
      )
      SELECT *
      FROM ranked_offers
      WHERE destination_rank <= $8
      ORDER BY
        COALESCE(normalized_total_krw, total_price) ASC,
        CASE WHEN stop_count = 0 THEN 0 ELSE 1 END ASC,
        COALESCE(duration_minutes, 99999) ASC,
        depart_date ASC
      LIMIT $7
    `,
    ["ICN", ["TYO", "FUK"], "adt1", 6, 8, eligibleKeys, limit, 120],
  );
  return rows;
}

async function tableCount(client, tableName) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
  return Number(rows[0]?.count ?? 0);
}

async function activeTableCount(client, tableName) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE is_active = true`);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();

  try {
    await requireTables(client);

    const counts = {
      places: await tableCount(client, "places"),
      offers_total: await tableCount(client, "offers"),
      offers_active: await activeTableCount(client, "offers"),
      deals_current_total: await tableCount(client, "deals_current"),
      deals_current_active: await activeTableCount(client, "deals_current"),
      source_health: await tableCount(client, "source_health"),
    };
    assert.ok(counts.places > 0, "places must be seeded");
    assert.ok(counts.offers_active > 0, "active offers must be seeded");
    assert.ok(counts.deals_current_active > 0, "active deals_current rows must be materialized");
    assert.ok(counts.source_health >= SOURCE_POLICY_CATALOG.length, "source_health must include policy catalog rows");

    const { rows: batchRows } = await client.query("SELECT data FROM batch_state WHERE key = 'last_batch'");
    assert.equal(batchRows[0]?.data?.status, "success", "last_batch state must be successful");

    const sourceFlags = await resolvedSourceFlags(client);
    const japanRows = await searchJapanOffers(client, sourceFlags);
    const japanDestinations = new Set(japanRows.map((row) => String(row.destination_city_id)));
    assert.ok(japanRows.length > 0, "Japan search should return seeded offers");
    assert.ok(japanDestinations.has("FUK"), "Japan search should include Fukuoka candidates");
    assert.ok(japanDestinations.has("TYO"), "Japan search should include Tokyo candidates");
    assert.ok(
      japanRows.every((row) => isOfferSourceEligible(offerPolicyShape(row), sourceFlags)),
      "Japan search rows must respect resolved source flags",
    );

    const koreanOnlyRows = await searchJapanOffers(client, ["korean_air_official"], 50);
    assert.ok(koreanOnlyRows.length > 0, "Korean Air official-only search should return seeded offers");
    assert.deepEqual(
      koreanOnlyRows.filter((row) => row.source_type === "meta_search" || row.booking_source !== "ke" || row.airline_code !== "KE"),
      [],
      "Korean Air official-only search must not leak meta-search KE rows",
    );
    assert.deepEqual(await searchJapanOffers(client, []), [], "disabled source set should return no offers");

    const distinctSources = [...new Set(japanRows.map((row) => String(row.booking_source)))].sort();
    const bestOffer = japanRows[0];
    console.log(JSON.stringify({
      status: "ok",
      source_flags: sourceFlags,
      table_counts: counts,
      japan_search_offer_count: japanRows.length,
      japan_destinations: [...japanDestinations].sort(),
      distinct_sources: distinctSources,
      korean_air_official_only_count: koreanOnlyRows.length,
      best_offer: {
        offer_id: bestOffer.offer_id,
        booking_source: bestOffer.booking_source,
        airline_code: bestOffer.airline_code,
        cabin_group: bestOffer.cabin_group,
        normalized_total_krw: Number(bestOffer.normalized_total_krw),
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("DB search smoke failed.");
  console.error(err);
  process.exit(1);
});
