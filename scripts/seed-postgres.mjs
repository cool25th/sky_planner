import { createHash } from "node:crypto";

import pg from "pg";

import {
  availableWeeks,
  buildMarket,
} from "../lib/mock-market.ts";
import {
  SOURCE_POLICY_CATALOG,
  eligibleBookingSourceKeys,
  enabledSourceFlagsFromEnv,
  isOfferSourceEligible,
} from "../lib/source-policy.ts";

const { Client } = pg;

const DEFAULT_DATABASE_URL = "postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner";

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function utcTimestamp(value) {
  const raw = String(value);
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw}Z`;
  return new Date(raw).toISOString();
}

function batchTimestamp() {
  return utcTimestamp(process.env.SEED_LAST_BATCH_AT || new Date().toISOString());
}

function stopsBucket(stops) {
  if (stops === 0) return "direct";
  if (stops === 1) return "1stop";
  return "2plus";
}

function badgeType(offer) {
  if (offer.badges.includes("공식 특가")) return "official_promo";
  if (offer.badges.includes("가격 특가")) return "price_deal";
  return null;
}

function toDbCabin(cabin) {
  return cabin.toLowerCase();
}

function materializedHash(value) {
  return md5(JSON.stringify(value));
}

function collectOfferRows(lastBatchAt) {
  const rows = [];
  for (const week of availableWeeks()) {
    for (const offer of buildMarket(week.code, lastBatchAt)) {
      rows.push({ ...offer, week: week.code });
    }
  }
  return rows;
}

function buildPlaceRows(offers) {
  const byCode = new Map();
  for (const offer of offers) {
    if (byCode.has(offer.destination_code)) continue;
    byCode.set(offer.destination_code, {
      place_id: offer.destination_code,
      place_type: "city",
      display_name_ko: offer.destination_city,
      display_name_en: offer.destination_code,
      iata_code: offer.destination_code,
      country_code: offer.destination_country,
      region: offer.region_code,
      linked_airports: [offer.destination_code],
      latitude: offer.lat,
      longitude: offer.lon,
      is_active: true,
    });
  }
  return [...byCode.values()].sort((left, right) => left.place_id.localeCompare(right.place_id));
}

function buildOfferDbRows(offers, executionId) {
  return offers.map((offer) => {
    const itineraryHash = md5([
      offer.origin,
      offer.destination_code,
      offer.depart_date,
      offer.return_date,
      offer.airline_code,
      offer.cabin_group,
      offer.stops,
    ].join("|"));
    const writeFingerprint = md5([
      offer.price_total,
      offer.price_status,
      offer.deep_link,
      offer.stops,
      offer.outbound_departure_at,
      offer.inbound_departure_at,
    ].join("|"));

    return {
      offer_id: offer.offer_id,
      itinerary_hash: itineraryHash,
      write_fingerprint: writeFingerprint,
      source_job_id: `local_mock_${offer.source_id}`,
      execution_id: executionId,
      parser_version: "local-mock-v1",
      schema_validator: "seed-postgres-v1",
      capture_channel: "xhr",
      raw_payload_ref: `local://mock/${executionId}/${offer.offer_id}.json`,
      origin_airport: offer.origin,
      origin_city_id: offer.origin,
      destination_airport: offer.destination_code,
      destination_city_id: offer.destination_code,
      depart_date: offer.depart_date,
      return_date: offer.return_date,
      stay_nights: offer.stay_nights,
      stay_bucket: offer.trip_bucket,
      week: offer.week,
      traveler: offer.traveler,
      airline_code: offer.airline_code,
      airline_name: offer.airline_name,
      operating_airline_code: offer.airline_code,
      operating_airline_name: offer.airline_name,
      booking_source: offer.source_id,
      source_type: offer.source_type,
      cabin_group: toDbCabin(offer.cabin_group),
      cabin_label_raw: offer.cabin_label_raw,
      fare_brand_raw: offer.fare_family,
      total_price: offer.price_total,
      currency: "KRW",
      tax_included: true,
      normalized_total_krw: offer.price_total,
      stop_count: offer.stops,
      stops_bucket: stopsBucket(offer.stops),
      departure_time_local: offer.outbound_departure_at,
      arrival_time_local: offer.outbound_arrival_at,
      return_departure_time_local: offer.inbound_departure_at,
      return_arrival_time_local: offer.inbound_arrival_at,
      duration_minutes: Math.round(offer.duration_hours * 60),
      return_duration_minutes: Math.round(offer.duration_hours * 60),
      duration_ratio_vs_direct_baseline: offer.is_direct ? 1 : 1.4,
      quality_bucket: offer.is_direct ? "preferred" : "acceptable",
      price_anomaly_status: "normal",
      deep_link: offer.deep_link,
      bookability_status: "available",
      price_status: offer.price_status,
      is_price_changed: offer.is_price_changed,
      warning_flags: offer.warning_flags,
      last_seen_at: utcTimestamp(offer.last_seen_at),
      last_batch_at: utcTimestamp(offer.last_batch_at),
      is_active: true,
    };
  });
}

function emptyCabinState() {
  return {
    min_total_krw: null,
    discount_pct: null,
    badge_type: null,
    price_status: null,
    best_depart_date: null,
    best_return_date: null,
    best_offer_id: null,
    representative_airline: null,
    representative_source: null,
    deep_link: null,
    last_seen_at: null,
    last_batch_at: null,
  };
}

function updateCabinState(state, offer) {
  if (state.min_total_krw !== null && offer.price_total >= state.min_total_krw) return;
  state.min_total_krw = offer.price_total;
  state.discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
  state.badge_type = badgeType(offer);
  state.price_status = offer.price_status;
  state.best_depart_date = offer.depart_date;
  state.best_return_date = offer.return_date;
  state.best_offer_id = offer.offer_id;
  state.representative_airline = offer.airline_code;
  state.representative_source = offer.source_id;
  state.deep_link = offer.deep_link;
  state.last_seen_at = utcTimestamp(offer.last_seen_at);
  state.last_batch_at = utcTimestamp(offer.last_batch_at);
}

function buildDealsDbRows(offers, sourceFlags) {
  const activeOffers = offers.filter((offer) => isOfferSourceEligible(offer, sourceFlags));
  const groups = new Map();

  for (const offer of activeOffers) {
    const key = `${offer.origin}_${offer.destination_code}_${offer.week}_${offer.trip_bucket}_${offer.traveler}`;
    const group = groups.get(key) ?? {
      deal_id: key,
      origin: offer.origin,
      traveler: offer.traveler,
      destination_city_id: offer.destination_code,
      destination_display_name: offer.destination_city,
      country_code: offer.destination_country,
      region: offer.region_code,
      week: offer.week,
      stay_bucket: offer.trip_bucket,
      latitude: offer.lat,
      longitude: offer.lon,
      economy: emptyCabinState(),
      business: emptyCabinState(),
      calendar: new Map(),
      warning_flags: new Set(),
      enabled_sources: new Set(),
    };

    const state = offer.cabin_group === "BUSINESS" ? group.business : group.economy;
    updateCabinState(state, offer);

    const cellKey = `${offer.depart_date}_${offer.return_date}`;
    const cell = group.calendar.get(cellKey) ?? {
      stay_nights: offer.stay_nights,
      economy_min_total_krw: null,
      economy_price_status: null,
      economy_is_best_cell: false,
      business_min_total_krw: null,
      business_price_status: null,
      business_is_best_cell: false,
    };
    if (offer.cabin_group === "BUSINESS") {
      if (cell.business_min_total_krw === null || offer.price_total < cell.business_min_total_krw) {
        cell.business_min_total_krw = offer.price_total;
        cell.business_price_status = offer.price_status;
      }
    } else if (cell.economy_min_total_krw === null || offer.price_total < cell.economy_min_total_krw) {
      cell.economy_min_total_krw = offer.price_total;
      cell.economy_price_status = offer.price_status;
    }
    group.calendar.set(cellKey, cell);

    for (const flag of offer.warning_flags) group.warning_flags.add(flag);
    group.enabled_sources.add(offer.source_id);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const cells = Object.fromEntries([...group.calendar.entries()].map(([key, cell]) => [
      key,
      {
        ...cell,
        economy_is_best_cell: group.economy.best_depart_date && key === `${group.economy.best_depart_date}_${group.economy.best_return_date}`,
        business_is_best_cell: group.business.best_depart_date && key === `${group.business.best_depart_date}_${group.business.best_return_date}`,
      },
    ]));
    const departDates = [...new Set([...group.calendar.keys()].map((key) => key.split("_")[0]))].sort();
    const returnDates = [...new Set([...group.calendar.keys()].map((key) => key.split("_")[1]))].sort();
    const calendar_matrix = {
      depart_dates: departDates,
      return_dates: returnDates,
      cells,
      generated_at: group.economy.last_batch_at ?? group.business.last_batch_at,
    };

    return {
      deal_id: group.deal_id,
      materialized_hash: materializedHash({
        economy: group.economy.best_offer_id,
        business: group.business.best_offer_id,
        calendar_matrix,
      }),
      origin: group.origin,
      traveler: group.traveler,
      destination_city_id: group.destination_city_id,
      destination_display_name: group.destination_display_name,
      country_code: group.country_code,
      region: group.region,
      week: group.week,
      stay_bucket: group.stay_bucket,
      latitude: group.latitude,
      longitude: group.longitude,
      economy: group.economy,
      business: group.business,
      calendar_matrix,
      warning_flags: [...group.warning_flags].sort(),
      enabled_sources: [...group.enabled_sources].sort(),
      is_active: true,
    };
  });
}

function sourceRows(offers, sourceFlags, executionId, lastBatchAt) {
  return SOURCE_POLICY_CATALOG.map((source) => {
    const sourceOffers = offers.filter((offer) => isOfferSourceEligible(offer, [source.source_id]));
    const enabled = sourceFlags.includes(source.source_id);
    return {
      source_id: source.source_id,
      enabled_by_flag: enabled,
      is_paused: false,
      circuit_breaker_open: false,
      consecutive_failures: 0,
      stats_24h: {
        total_jobs: enabled ? 1 : 0,
        success_count: enabled ? 1 : 0,
        failure_count: 0,
        avg_latency_ms: enabled ? 1200 : 0,
        block_count: 0,
        schema_validation_failure_count: 0,
        price_anomaly_count: 0,
        write_amplification_ratio: sourceOffers.length ? 1 : 0,
      },
      last_success_at: enabled ? utcTimestamp(lastBatchAt) : null,
      last_checked_at: utcTimestamp(lastBatchAt),
      execution_id: executionId,
      offers_found: sourceOffers.length,
    };
  });
}

async function upsertPlaces(client, rows) {
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        place_id text,
        place_type text,
        display_name_ko text,
        display_name_en text,
        iata_code text,
        country_code text,
        region text,
        linked_airports jsonb,
        latitude double precision,
        longitude double precision,
        is_active boolean
      )
    )
    INSERT INTO places (
      place_id, place_type, display_name_ko, display_name_en, iata_code, country_code,
      region, linked_airports, latitude, longitude, is_active
    )
    SELECT place_id, place_type, display_name_ko, display_name_en, iata_code, country_code,
      region, ARRAY(SELECT jsonb_array_elements_text(COALESCE(linked_airports, '[]'::jsonb))), latitude, longitude, is_active
    FROM input
    ON CONFLICT (place_id) DO UPDATE SET
      display_name_ko = EXCLUDED.display_name_ko,
      display_name_en = EXCLUDED.display_name_en,
      iata_code = EXCLUDED.iata_code,
      country_code = EXCLUDED.country_code,
      region = EXCLUDED.region,
      linked_airports = EXCLUDED.linked_airports,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      is_active = EXCLUDED.is_active
  `, [JSON.stringify(rows)]);
}

async function upsertOffers(client, rows) {
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        offer_id text,
        itinerary_hash text,
        write_fingerprint text,
        source_job_id text,
        execution_id text,
        parser_version text,
        schema_validator text,
        capture_channel text,
        raw_payload_ref text,
        origin_airport text,
        origin_city_id text,
        destination_airport text,
        destination_city_id text,
        depart_date date,
        return_date date,
        stay_nights integer,
        stay_bucket text,
        week text,
        traveler text,
        airline_code text,
        airline_name text,
        operating_airline_code text,
        operating_airline_name text,
        booking_source text,
        source_type text,
        cabin_group text,
        cabin_label_raw text,
        fare_brand_raw text,
        total_price numeric,
        currency text,
        tax_included boolean,
        normalized_total_krw numeric,
        stop_count integer,
        stops_bucket text,
        departure_time_local text,
        arrival_time_local text,
        return_departure_time_local text,
        return_arrival_time_local text,
        duration_minutes integer,
        return_duration_minutes integer,
        duration_ratio_vs_direct_baseline numeric,
        quality_bucket text,
        price_anomaly_status text,
        deep_link text,
        bookability_status text,
        price_status text,
        is_price_changed boolean,
        warning_flags jsonb,
        last_seen_at timestamptz,
        last_batch_at timestamptz,
        is_active boolean
      )
    )
    INSERT INTO offers (
      offer_id, itinerary_hash, write_fingerprint, source_job_id, execution_id, parser_version,
      schema_validator, capture_channel, raw_payload_ref, origin_airport, origin_city_id,
      destination_airport, destination_city_id, depart_date, return_date, stay_nights, stay_bucket,
      week, traveler, airline_code, airline_name, operating_airline_code, operating_airline_name,
      booking_source, source_type, cabin_group, cabin_label_raw, fare_brand_raw, total_price,
      currency, tax_included, normalized_total_krw, stop_count, stops_bucket, departure_time_local,
      arrival_time_local, return_departure_time_local, return_arrival_time_local, duration_minutes,
      return_duration_minutes, duration_ratio_vs_direct_baseline, quality_bucket, price_anomaly_status,
      deep_link, bookability_status, price_status, is_price_changed, warning_flags, last_seen_at,
      last_batch_at, is_active
    )
    SELECT
      offer_id, itinerary_hash, write_fingerprint, source_job_id, execution_id, parser_version,
      schema_validator, capture_channel, raw_payload_ref, origin_airport, origin_city_id,
      destination_airport, destination_city_id, depart_date, return_date, stay_nights, stay_bucket,
      week, traveler, airline_code, airline_name, operating_airline_code, operating_airline_name,
      booking_source, source_type, cabin_group, cabin_label_raw, fare_brand_raw, total_price,
      currency, tax_included, normalized_total_krw, stop_count, stops_bucket, departure_time_local,
      arrival_time_local, return_departure_time_local, return_arrival_time_local, duration_minutes,
      return_duration_minutes, duration_ratio_vs_direct_baseline, quality_bucket, price_anomaly_status,
      deep_link, bookability_status, price_status, is_price_changed,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(warning_flags, '[]'::jsonb))), last_seen_at, last_batch_at, is_active
    FROM input
    ON CONFLICT (offer_id) DO UPDATE SET
      write_fingerprint = EXCLUDED.write_fingerprint,
      execution_id = EXCLUDED.execution_id,
      parser_version = EXCLUDED.parser_version,
      raw_payload_ref = EXCLUDED.raw_payload_ref,
      total_price = EXCLUDED.total_price,
      normalized_total_krw = EXCLUDED.normalized_total_krw,
      deep_link = EXCLUDED.deep_link,
      bookability_status = EXCLUDED.bookability_status,
      price_status = EXCLUDED.price_status,
      is_price_changed = EXCLUDED.is_price_changed,
      warning_flags = EXCLUDED.warning_flags,
      last_seen_at = EXCLUDED.last_seen_at,
      last_batch_at = EXCLUDED.last_batch_at,
      is_active = EXCLUDED.is_active
  `, [JSON.stringify(rows)]);
}

async function upsertDeals(client, rows) {
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        deal_id text,
        materialized_hash text,
        origin text,
        traveler text,
        destination_city_id text,
        destination_display_name text,
        country_code text,
        region text,
        week text,
        stay_bucket text,
        latitude double precision,
        longitude double precision,
        economy jsonb,
        business jsonb,
        calendar_matrix jsonb,
        warning_flags jsonb,
        enabled_sources jsonb,
        is_active boolean
      )
    )
    INSERT INTO deals_current (
      deal_id, schema_version, materialized_hash, origin, traveler, destination_city_id,
      destination_display_name, country_code, region, week, stay_bucket, latitude, longitude,
      economy_min_total_krw, economy_discount_pct, economy_badge_type, economy_price_status,
      economy_best_depart_date, economy_best_return_date, economy_best_offer_id,
      economy_representative_airline, economy_representative_source, economy_deep_link,
      economy_last_seen_at, economy_last_batch_at,
      business_min_total_krw, business_discount_pct, business_badge_type, business_price_status,
      business_best_depart_date, business_best_return_date, business_best_offer_id,
      business_representative_airline, business_representative_source, business_deep_link,
      business_last_seen_at, business_last_batch_at,
      calendar_matrix, warning_flags, enabled_sources, is_active
    )
    SELECT
      deal_id, 1, materialized_hash, origin, traveler, destination_city_id,
      destination_display_name, country_code, region, week, stay_bucket, latitude, longitude,
      (economy->>'min_total_krw')::numeric, (economy->>'discount_pct')::numeric, economy->>'badge_type', economy->>'price_status',
      economy->>'best_depart_date', economy->>'best_return_date', economy->>'best_offer_id',
      economy->>'representative_airline', economy->>'representative_source', economy->>'deep_link',
      (economy->>'last_seen_at')::timestamptz, (economy->>'last_batch_at')::timestamptz,
      (business->>'min_total_krw')::numeric, (business->>'discount_pct')::numeric, business->>'badge_type', business->>'price_status',
      business->>'best_depart_date', business->>'best_return_date', business->>'best_offer_id',
      business->>'representative_airline', business->>'representative_source', business->>'deep_link',
      (business->>'last_seen_at')::timestamptz, (business->>'last_batch_at')::timestamptz,
      calendar_matrix,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(warning_flags, '[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(enabled_sources, '[]'::jsonb))),
      is_active
    FROM input
    ON CONFLICT (deal_id) DO UPDATE SET
      materialized_hash = EXCLUDED.materialized_hash,
      destination_display_name = EXCLUDED.destination_display_name,
      country_code = EXCLUDED.country_code,
      region = EXCLUDED.region,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      economy_min_total_krw = EXCLUDED.economy_min_total_krw,
      economy_discount_pct = EXCLUDED.economy_discount_pct,
      economy_badge_type = EXCLUDED.economy_badge_type,
      economy_price_status = EXCLUDED.economy_price_status,
      economy_best_depart_date = EXCLUDED.economy_best_depart_date,
      economy_best_return_date = EXCLUDED.economy_best_return_date,
      economy_best_offer_id = EXCLUDED.economy_best_offer_id,
      economy_representative_airline = EXCLUDED.economy_representative_airline,
      economy_representative_source = EXCLUDED.economy_representative_source,
      economy_deep_link = EXCLUDED.economy_deep_link,
      economy_last_seen_at = EXCLUDED.economy_last_seen_at,
      economy_last_batch_at = EXCLUDED.economy_last_batch_at,
      business_min_total_krw = EXCLUDED.business_min_total_krw,
      business_discount_pct = EXCLUDED.business_discount_pct,
      business_badge_type = EXCLUDED.business_badge_type,
      business_price_status = EXCLUDED.business_price_status,
      business_best_depart_date = EXCLUDED.business_best_depart_date,
      business_best_return_date = EXCLUDED.business_best_return_date,
      business_best_offer_id = EXCLUDED.business_best_offer_id,
      business_representative_airline = EXCLUDED.business_representative_airline,
      business_representative_source = EXCLUDED.business_representative_source,
      business_deep_link = EXCLUDED.business_deep_link,
      business_last_seen_at = EXCLUDED.business_last_seen_at,
      business_last_batch_at = EXCLUDED.business_last_batch_at,
      calendar_matrix = EXCLUDED.calendar_matrix,
      warning_flags = EXCLUDED.warning_flags,
      enabled_sources = EXCLUDED.enabled_sources,
      is_active = EXCLUDED.is_active
  `, [JSON.stringify(rows)]);
}

async function upsertSources(client, rows, sourceFlags) {
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        source_id text,
        enabled_by_flag boolean,
        is_paused boolean,
        circuit_breaker_open boolean,
        consecutive_failures integer,
        stats_24h jsonb,
        last_success_at timestamptz,
        last_checked_at timestamptz,
        execution_id text,
        offers_found integer
      )
    )
    INSERT INTO source_health (
      source_id, enabled_by_flag, is_paused, circuit_breaker_open, consecutive_failures,
      stats_24h, last_success_at, last_checked_at
    )
    SELECT source_id, enabled_by_flag, is_paused, circuit_breaker_open, consecutive_failures,
      stats_24h, last_success_at, last_checked_at
    FROM input
    ON CONFLICT (source_id) DO UPDATE SET
      enabled_by_flag = EXCLUDED.enabled_by_flag,
      is_paused = EXCLUDED.is_paused,
      circuit_breaker_open = EXCLUDED.circuit_breaker_open,
      consecutive_failures = EXCLUDED.consecutive_failures,
      stats_24h = EXCLUDED.stats_24h,
      last_success_at = EXCLUDED.last_success_at,
      last_checked_at = EXCLUDED.last_checked_at
  `, [JSON.stringify(rows)]);

  await client.query(`
    INSERT INTO source_jobs (
      execution_id, source_id, status, parser_version, offers_found, offers_changed,
      snapshots_written, deals_recomputed, started_at, completed_at
    )
    SELECT execution_id, source_id, 'success', 'local-mock-v1', offers_found, offers_found,
      0, 0, NOW(), NOW()
    FROM jsonb_to_recordset($1::jsonb) AS x(
      execution_id text,
      source_id text,
      offers_found integer
    )
    WHERE source_id = ANY($2::text[])
  `, [JSON.stringify(rows), sourceFlags]);
}

async function upsertBatchState(client, summary, offerHashes) {
  await client.query(`
    INSERT INTO batch_state (key, data)
    VALUES
      ('last_batch', $1::jsonb),
      ('offer_hashes', $2::jsonb)
    ON CONFLICT (key) DO UPDATE SET
      data = EXCLUDED.data
  `, [JSON.stringify(summary), JSON.stringify(offerHashes)]);
}

async function deactivateStaleReadModelRows(client, offerRows, dealRows) {
  await client.query(`
    CREATE TEMP TABLE current_seed_offer_ids (
      offer_id text PRIMARY KEY
    ) ON COMMIT DROP
  `);
  await client.query(`
    INSERT INTO current_seed_offer_ids (offer_id)
    SELECT value
    FROM jsonb_array_elements_text($1::jsonb)
  `, [JSON.stringify(offerRows.map((offer) => offer.offer_id))]);
  const offerResult = await client.query(`
    UPDATE offers AS offer
    SET is_active = false
    WHERE offer.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM current_seed_offer_ids AS current_offer
        WHERE current_offer.offer_id = offer.offer_id
      )
  `);

  await client.query(`
    CREATE TEMP TABLE current_seed_deal_ids (
      deal_id text PRIMARY KEY
    ) ON COMMIT DROP
  `);
  await client.query(`
    INSERT INTO current_seed_deal_ids (deal_id)
    SELECT value
    FROM jsonb_array_elements_text($1::jsonb)
  `, [JSON.stringify(dealRows.map((deal) => deal.deal_id))]);
  const dealResult = await client.query(`
    UPDATE deals_current AS deal
    SET is_active = false
    WHERE deal.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM current_seed_deal_ids AS current_deal
        WHERE current_deal.deal_id = deal.deal_id
      )
  `);

  return {
    stale_offers_deactivated: offerResult.rowCount ?? 0,
    stale_deals_deactivated: dealResult.rowCount ?? 0,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const lastBatchAt = batchTimestamp();
  const executionId = `local_mock_${lastBatchAt.replace(/[^0-9]/g, "")}`;
  const sourceFlags = enabledSourceFlagsFromEnv();
  const allOffers = collectOfferRows(lastBatchAt);
  const eligibleKeys = [...eligibleBookingSourceKeys(sourceFlags)];
  const placeRows = buildPlaceRows(allOffers);
  const offerRows = buildOfferDbRows(allOffers, executionId);
  const dealRows = buildDealsDbRows(allOffers, sourceFlags);
  const sourceHealthRows = sourceRows(allOffers, sourceFlags, executionId, lastBatchAt);
  const offerHashes = Object.fromEntries(offerRows.map((offer) => [offer.offer_id, offer.write_fingerprint]));
  const summary = {
    status: "success",
    generated_at: new Date().toISOString(),
    last_batch_at: lastBatchAt,
    execution_id: executionId,
    source_flags: sourceFlags,
    eligible_booking_source_keys: eligibleKeys,
    places_written: placeRows.length,
    offers_written: offerRows.length,
    active_offer_candidates: allOffers.filter((offer) => isOfferSourceEligible(offer, sourceFlags)).length,
    deals_materialized: dealRows.length,
  };

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await upsertPlaces(client, placeRows);
    await upsertOffers(client, offerRows);
    await upsertDeals(client, dealRows);
    Object.assign(summary, await deactivateStaleReadModelRows(client, offerRows, dealRows));
    await upsertSources(client, sourceHealthRows, sourceFlags);
    await upsertBatchState(client, summary, offerHashes);
    await client.query("COMMIT");
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Failed to seed PostgreSQL batch data.");
  console.error(err);
  process.exit(1);
});
