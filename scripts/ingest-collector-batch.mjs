import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";
import { z } from "zod";

import {
  eligibleBookingSourceKeys,
  enabledSourceFlagsFromEnv,
} from "../lib/source-policy.ts";
import { serviceRequiresPostgres } from "../lib/service-mode.ts";

const { Client } = pg;

const DEFAULT_DATABASE_URL = "postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner";
const DEFAULT_PARSER_VERSION = "collector-normalized-v1";

const CaptureChannelSchema = z.enum(["xhr", "graphql", "html_state"]);
const CabinSchema = z.enum(["economy", "premium_economy", "business", "first"]);
const SourceTypeSchema = z.enum(["meta_search", "airline_official", "promo_page"]);
const PriceStatusSchema = z.enum(["active", "stale", "sold_out"]);
const BookabilityStatusSchema = z.enum(["available", "uncertain", "sold_out"]);
const PriceAnomalySchema = z.enum(["normal", "anomaly"]);

const PlaceSchema = z.object({
  place_id: z.string().min(1),
  place_type: z.enum(["city", "airport", "region"]).default("city"),
  display_name_ko: z.string().min(1),
  display_name_en: z.string().min(1),
  iata_code: z.string().optional(),
  country_code: z.string().min(2),
  region: z.string().min(1),
  linked_airports: z.array(z.string()).default([]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  is_active: z.boolean().default(true),
});

const NormalizedOfferSchema = z.object({
  offer_id: z.string().optional(),
  source_offer_id: z.string().optional(),
  raw_payload_ref: z.string().min(1),
  capture_channel: CaptureChannelSchema.default("xhr"),
  origin_airport: z.string().min(3),
  origin_city_id: z.string().optional(),
  destination_airport: z.string().min(3),
  destination_city_id: z.string().min(3),
  destination_display_name: z.string().min(1),
  destination_display_name_en: z.string().optional(),
  country_code: z.string().min(2),
  region: z.string().min(1),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  depart_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stay_nights: z.number().int().positive().optional(),
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  traveler: z.string().default("adt1"),
  airline_code: z.string().min(2),
  airline_name: z.string().min(1),
  operating_airline_code: z.string().optional(),
  operating_airline_name: z.string().optional(),
  booking_source: z.string().min(1),
  source_type: SourceTypeSchema,
  cabin_group: CabinSchema,
  cabin_label_raw: z.string().optional(),
  fare_brand_raw: z.string().optional(),
  total_price: z.number().positive(),
  currency: z.string().default("KRW"),
  tax_included: z.boolean().default(true),
  normalized_total_krw: z.number().positive().optional(),
  fx_rate_source: z.string().default("kexim_daily"),
  fx_rate_date: z.string().optional(),
  stop_count: z.number().int().min(0).default(0),
  departure_time_local: z.string().optional(),
  arrival_time_local: z.string().optional(),
  return_departure_time_local: z.string().optional(),
  return_arrival_time_local: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  return_duration_minutes: z.number().int().positive().optional(),
  layover_duration_minutes: z.number().int().min(0).optional(),
  free_baggage_allowance: z.string().optional(),
  seats_left: z.number().int().min(0).optional(),
  is_codeshare: z.boolean().default(false),
  duration_ratio_vs_direct_baseline: z.number().positive().optional(),
  quality_bucket: z.enum(["preferred", "acceptable", "degraded", "excluded"]).optional(),
  price_anomaly_status: PriceAnomalySchema.default("normal"),
  price_anomaly_reason: z.string().optional(),
  deep_link: z.string().min(1),
  bookability_status: BookabilityStatusSchema.default("available"),
  price_status: PriceStatusSchema.default("active"),
  is_price_changed: z.boolean().default(false),
  warning_flags: z.array(z.string()).default([]),
  last_seen_at: z.string().optional(),
});

const CollectorBatchSchema = z.object({
  schema_version: z.literal("collector.normalized_batch.v1"),
  execution_id: z.string().min(1),
  source_id: z.string().min(1),
  source_type: SourceTypeSchema,
  parser_version: z.string().default(DEFAULT_PARSER_VERSION),
  schema_validator: z.string().default("collector-ingest-v1"),
  collected_at: z.string().min(1),
  artifact_prefix: z.string().optional(),
  places: z.array(PlaceSchema).default([]),
  offers: z.array(NormalizedOfferSchema).min(1),
  stats: z.object({
    started_at: z.string().optional(),
    completed_at: z.string().optional(),
    avg_latency_ms: z.number().int().min(0).optional(),
    block_count: z.number().int().min(0).default(0),
    schema_validation_failed_count: z.number().int().min(0).default(0),
    price_anomaly_count: z.number().int().min(0).optional(),
  }).default({}),
});

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

function sqlDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function sqlTimestampMinute(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toISOString().slice(0, 16);
}

function stayNights(departDate, returnDate, explicit) {
  if (explicit) return explicit;
  const depart = new Date(`${departDate}T00:00:00Z`);
  const ret = new Date(`${returnDate}T00:00:00Z`);
  return Math.round((ret.getTime() - depart.getTime()) / 86400000);
}

function stayBucket(nights) {
  if (nights >= 3 && nights <= 4) return "3_4";
  if (nights >= 5 && nights <= 7) return "5_7";
  if (nights >= 8 && nights <= 14) return "8_14";
  throw new Error(`Unsupported stay_nights for MVP bucket: ${nights}`);
}

function stopsBucket(stops) {
  if (stops === 0) return "direct";
  if (stops === 1) return "1stop";
  return "2plus";
}

function qualityBucket(offer) {
  if (offer.quality_bucket) return offer.quality_bucket;
  if (offer.stop_count === 0) return "preferred";
  if (offer.stop_count === 1) return "acceptable";
  return "degraded";
}

function itineraryHash(offer) {
  return md5([
    offer.origin_airport,
    offer.destination_city_id,
    offer.depart_date,
    offer.return_date,
    offer.airline_code,
    offer.cabin_group,
    offer.stop_count,
  ].join("|"));
}

function offerId(batch, offer) {
  return offer.offer_id ?? `collector-${md5([
    batch.source_id,
    offer.source_offer_id ?? "",
    offer.origin_airport,
    offer.destination_city_id,
    offer.depart_date,
    offer.return_date,
    offer.airline_code,
    offer.cabin_group,
    offer.total_price,
  ].join("|")).slice(0, 20)}`;
}

function writeFingerprint(offer) {
  return md5([
    offer.normalized_total_krw ?? offer.total_price,
    offer.price_status,
    offer.bookability_status,
    offer.deep_link,
    offer.stop_count,
    offer.departure_time_local ?? "",
    offer.arrival_time_local ?? "",
    offer.return_departure_time_local ?? "",
    offer.return_arrival_time_local ?? "",
  ].join("|"));
}

export function parseCollectorBatch(payload) {
  return CollectorBatchSchema.parse(payload);
}

export async function loadCollectorBatch(path) {
  return parseCollectorBatch(JSON.parse(await readFile(path, "utf-8")));
}

function buildPlaceRows(batch) {
  const byId = new Map(batch.places.map((place) => [place.place_id, place]));
  for (const offer of batch.offers) {
    if (!byId.has(offer.destination_city_id)) {
      byId.set(offer.destination_city_id, {
        place_id: offer.destination_city_id,
        place_type: "city",
        display_name_ko: offer.destination_display_name,
        display_name_en: offer.destination_display_name_en ?? offer.destination_city_id,
        iata_code: offer.destination_city_id,
        country_code: offer.country_code,
        region: offer.region,
        linked_airports: [offer.destination_airport],
        latitude: offer.latitude,
        longitude: offer.longitude,
        is_active: true,
      });
    }
  }
  return [...byId.values()];
}

function buildOfferRows(batch) {
  return batch.offers.map((offer) => {
    const nights = stayNights(offer.depart_date, offer.return_date, offer.stay_nights);
    const id = offerId(batch, offer);
    return {
      offer_id: id,
      itinerary_hash: itineraryHash(offer),
      write_fingerprint: writeFingerprint(offer),
      source_job_id: `${batch.execution_id}:${batch.source_id}`,
      execution_id: batch.execution_id,
      parser_version: batch.parser_version,
      schema_validator: batch.schema_validator,
      capture_channel: offer.capture_channel,
      raw_payload_ref: offer.raw_payload_ref,
      origin_airport: offer.origin_airport,
      origin_city_id: offer.origin_city_id ?? offer.origin_airport,
      destination_airport: offer.destination_airport,
      destination_city_id: offer.destination_city_id,
      depart_date: offer.depart_date,
      return_date: offer.return_date,
      stay_nights: nights,
      stay_bucket: stayBucket(nights),
      week: offer.week,
      traveler: offer.traveler,
      airline_code: offer.airline_code,
      airline_name: offer.airline_name,
      operating_airline_code: offer.operating_airline_code ?? offer.airline_code,
      operating_airline_name: offer.operating_airline_name ?? offer.airline_name,
      booking_source: offer.booking_source,
      source_type: offer.source_type,
      cabin_group: offer.cabin_group,
      cabin_label_raw: offer.cabin_label_raw ?? offer.cabin_group,
      fare_brand_raw: offer.fare_brand_raw ?? null,
      total_price: offer.total_price,
      currency: offer.currency,
      tax_included: offer.tax_included,
      normalized_total_krw: offer.normalized_total_krw ?? offer.total_price,
      fx_rate_source: offer.fx_rate_source,
      fx_rate_date: offer.fx_rate_date ?? null,
      stop_count: offer.stop_count,
      stops_bucket: stopsBucket(offer.stop_count),
      departure_time_local: offer.departure_time_local ?? null,
      arrival_time_local: offer.arrival_time_local ?? null,
      return_departure_time_local: offer.return_departure_time_local ?? null,
      return_arrival_time_local: offer.return_arrival_time_local ?? null,
      duration_minutes: offer.duration_minutes ?? null,
      return_duration_minutes: offer.return_duration_minutes ?? null,
      layover_duration_minutes: offer.layover_duration_minutes ?? null,
      free_baggage_allowance: offer.free_baggage_allowance ?? null,
      seats_left: offer.seats_left ?? null,
      is_codeshare: offer.is_codeshare,
      duration_ratio_vs_direct_baseline: offer.duration_ratio_vs_direct_baseline ?? (offer.stop_count === 0 ? 1 : 1.4),
      quality_bucket: qualityBucket(offer),
      price_anomaly_status: offer.price_anomaly_status,
      price_anomaly_reason: offer.price_anomaly_reason ?? null,
      deep_link: offer.deep_link,
      bookability_status: offer.bookability_status,
      price_status: offer.price_status,
      captured_at: utcTimestamp(batch.collected_at),
      is_price_changed: offer.is_price_changed,
      warning_flags: offer.warning_flags,
      last_seen_at: utcTimestamp(offer.last_seen_at ?? batch.collected_at),
      last_batch_at: utcTimestamp(batch.collected_at),
      is_active: true,
    };
  });
}

// DATA-20260904-001: require/database.md 보존 계약 — fare_snapshots expire_at은 수집시각+90일.
// 만료 정리(DELETE) 소비자는 별도 승인 작업으로 남는다(여기선 만료 시각만 계약대로 기록).
const SNAPSHOT_RETENTION_DAYS = 90;

function snapshotExpireAt(capturedAt) {
  const ms = Date.parse(capturedAt);
  return Number.isFinite(ms) ? new Date(ms + SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString() : null;
}

export function buildSnapshotRows(offerRows) {
  return offerRows.map((offer) => ({
    snapshot_id: `snapshot-${md5(`${offer.offer_id}|${offer.execution_id}`).slice(0, 20)}`,
    snapshot_key: `${offer.origin_airport}_${offer.destination_city_id}_${offer.depart_date}_${offer.return_date}_${offer.cabin_group}_${offer.traveler}_${offer.booking_source}`,
    source_job_id: offer.source_job_id,
    execution_id: offer.execution_id,
    collected_at: offer.captured_at,
    quote_type: "batch",
    write_fingerprint: offer.write_fingerprint,
    origin: offer.origin_airport,
    destination_city_id: offer.destination_city_id,
    depart_date: offer.depart_date,
    return_date: offer.return_date,
    stay_bucket: offer.stay_bucket,
    traveler: offer.traveler,
    airline_code: offer.airline_code,
    cabin_group: offer.cabin_group,
    tax_included: offer.tax_included,
    total_price: offer.total_price,
    currency: offer.currency,
    normalized_total_krw: offer.normalized_total_krw,
    fx_rate_source: offer.fx_rate_source,
    fx_rate_date: offer.fx_rate_date,
    source_id: offer.booking_source,
    parser_version: offer.parser_version,
    capture_channel: offer.capture_channel,
    raw_payload_ref: offer.raw_payload_ref,
    verification_status: offer.price_anomaly_status === "anomaly" ? "failed" : "verified",
    price_anomaly_status: offer.price_anomaly_status,
    expire_at: snapshotExpireAt(offer.captured_at),
  }));
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
  const price = Number(offer.normalized_total_krw ?? offer.total_price);
  if (state.min_total_krw !== null && price >= state.min_total_krw) return;
  state.min_total_krw = price;
  state.discount_pct = null;
  state.badge_type = null;
  state.price_status = offer.price_status;
  state.best_depart_date = sqlDate(offer.depart_date);
  state.best_return_date = sqlDate(offer.return_date);
  state.best_offer_id = offer.offer_id;
  state.representative_airline = offer.airline_code;
  state.representative_source = offer.booking_source;
  state.deep_link = offer.deep_link;
  state.last_seen_at = sqlTimestampMinute(offer.last_seen_at);
  state.last_batch_at = sqlTimestampMinute(offer.last_batch_at);
}

function buildDealRows(sqlOffers) {
  const groups = new Map();
  for (const offer of sqlOffers) {
    const key = `${offer.origin_airport}_${offer.destination_city_id}_${offer.week}_${offer.stay_bucket}_${offer.traveler}`;
    const group = groups.get(key) ?? {
      deal_id: key,
      origin: offer.origin_airport,
      traveler: offer.traveler,
      destination_city_id: offer.destination_city_id,
      destination_display_name: offer.destination_display_name ?? offer.destination_city_id,
      country_code: offer.country_code,
      region: offer.region,
      week: offer.week,
      stay_bucket: offer.stay_bucket,
      latitude: offer.latitude === null ? null : Number(offer.latitude),
      longitude: offer.longitude === null ? null : Number(offer.longitude),
      economy: emptyCabinState(),
      business: emptyCabinState(),
      calendar: new Map(),
      warning_flags: new Set(),
      enabled_sources: new Set(),
    };

    const cabin = String(offer.cabin_group).toLowerCase();
    const state = cabin === "business" ? group.business : group.economy;
    updateCabinState(state, offer);

    const cellKey = `${sqlDate(offer.depart_date)}_${sqlDate(offer.return_date)}`;
    const cell = group.calendar.get(cellKey) ?? {
      stay_nights: Number(offer.stay_nights ?? 0),
      economy_min_total_krw: null,
      economy_price_status: null,
      economy_is_best_cell: false,
      business_min_total_krw: null,
      business_price_status: null,
      business_is_best_cell: false,
    };
    const price = Number(offer.normalized_total_krw ?? offer.total_price);
    if (cabin === "business") {
      if (cell.business_min_total_krw === null || price < cell.business_min_total_krw) {
        cell.business_min_total_krw = price;
        cell.business_price_status = offer.price_status;
      }
    } else if (cell.economy_min_total_krw === null || price < cell.economy_min_total_krw) {
      cell.economy_min_total_krw = price;
      cell.economy_price_status = offer.price_status;
    }
    group.calendar.set(cellKey, cell);

    for (const flag of offer.warning_flags ?? []) group.warning_flags.add(flag);
    group.enabled_sources.add(offer.booking_source);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const cells = Object.fromEntries([...group.calendar.entries()].map(([key, cell]) => [
      key,
      {
        ...cell,
        economy_is_best_cell: Boolean(group.economy.best_depart_date && key === `${group.economy.best_depart_date}_${group.economy.best_return_date}`),
        business_is_best_cell: Boolean(group.business.best_depart_date && key === `${group.business.best_depart_date}_${group.business.best_return_date}`),
      },
    ]));
    const calendar_matrix = {
      depart_dates: [...new Set([...group.calendar.keys()].map((key) => key.split("_")[0]))].sort(),
      return_dates: [...new Set([...group.calendar.keys()].map((key) => key.split("_")[1]))].sort(),
      cells,
      generated_at: group.economy.last_batch_at ?? group.business.last_batch_at,
    };
    return {
      ...group,
      materialized_hash: md5(JSON.stringify({
        economy: group.economy.best_offer_id,
        business: group.business.best_offer_id,
        calendar_matrix,
      })),
      calendar_matrix,
      warning_flags: [...group.warning_flags].sort(),
      enabled_sources: [...group.enabled_sources].sort(),
      is_active: true,
    };
  });
}

async function currentOfferHashes(client) {
  const { rows } = await client.query("SELECT data FROM batch_state WHERE key = 'offer_hashes'");
  return rows[0]?.data ?? {};
}

async function upsertPlaces(client, rows) {
  if (!rows.length) return;
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
  if (!rows.length) return;
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        offer_id text, itinerary_hash text, write_fingerprint text, source_job_id text,
        execution_id text, parser_version text, schema_validator text, capture_channel text,
        raw_payload_ref text, origin_airport text, origin_city_id text, destination_airport text,
        destination_city_id text, depart_date date, return_date date, stay_nights integer,
        stay_bucket text, week text, traveler text, airline_code text, airline_name text,
        operating_airline_code text, operating_airline_name text, booking_source text,
        source_type text, cabin_group text, cabin_label_raw text, fare_brand_raw text,
        total_price numeric, currency text, tax_included boolean, normalized_total_krw numeric,
        fx_rate_source text, fx_rate_date text, stop_count integer, stops_bucket text,
        departure_time_local text, arrival_time_local text, return_departure_time_local text,
        return_arrival_time_local text, duration_minutes integer, return_duration_minutes integer,
        layover_duration_minutes integer, free_baggage_allowance text, seats_left integer,
        is_codeshare boolean, duration_ratio_vs_direct_baseline numeric, quality_bucket text,
        price_anomaly_status text, price_anomaly_reason text, deep_link text,
        bookability_status text, price_status text, captured_at timestamptz,
        is_price_changed boolean, warning_flags jsonb, last_seen_at timestamptz,
        last_batch_at timestamptz, is_active boolean
      )
    )
    INSERT INTO offers (
      offer_id, itinerary_hash, write_fingerprint, source_job_id, execution_id, parser_version,
      schema_validator, capture_channel, raw_payload_ref, origin_airport, origin_city_id,
      destination_airport, destination_city_id, depart_date, return_date, stay_nights, stay_bucket,
      week, traveler, airline_code, airline_name, operating_airline_code, operating_airline_name,
      booking_source, source_type, cabin_group, cabin_label_raw, fare_brand_raw, total_price,
      currency, tax_included, normalized_total_krw, fx_rate_source, fx_rate_date, stop_count,
      stops_bucket, departure_time_local, arrival_time_local, return_departure_time_local,
      return_arrival_time_local, duration_minutes, return_duration_minutes, layover_duration_minutes,
      free_baggage_allowance, seats_left, is_codeshare, duration_ratio_vs_direct_baseline,
      quality_bucket, price_anomaly_status, price_anomaly_reason, deep_link, bookability_status,
      price_status, captured_at, is_price_changed, warning_flags, last_seen_at, last_batch_at, is_active
    )
    SELECT
      offer_id, itinerary_hash, write_fingerprint, source_job_id, execution_id, parser_version,
      schema_validator, capture_channel, raw_payload_ref, origin_airport, origin_city_id,
      destination_airport, destination_city_id, depart_date, return_date, stay_nights, stay_bucket,
      week, traveler, airline_code, airline_name, operating_airline_code, operating_airline_name,
      booking_source, source_type, cabin_group, cabin_label_raw, fare_brand_raw, total_price,
      currency, tax_included, normalized_total_krw, fx_rate_source, fx_rate_date, stop_count,
      stops_bucket, departure_time_local, arrival_time_local, return_departure_time_local,
      return_arrival_time_local, duration_minutes, return_duration_minutes, layover_duration_minutes,
      free_baggage_allowance, seats_left, is_codeshare, duration_ratio_vs_direct_baseline,
      quality_bucket, price_anomaly_status, price_anomaly_reason, deep_link, bookability_status,
      price_status, captured_at, is_price_changed,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(warning_flags, '[]'::jsonb))),
      last_seen_at, last_batch_at, is_active
    FROM input
    ON CONFLICT (offer_id) DO UPDATE SET
      write_fingerprint = EXCLUDED.write_fingerprint,
      execution_id = EXCLUDED.execution_id,
      parser_version = EXCLUDED.parser_version,
      schema_validator = EXCLUDED.schema_validator,
      capture_channel = EXCLUDED.capture_channel,
      raw_payload_ref = EXCLUDED.raw_payload_ref,
      total_price = EXCLUDED.total_price,
      normalized_total_krw = EXCLUDED.normalized_total_krw,
      deep_link = EXCLUDED.deep_link,
      bookability_status = EXCLUDED.bookability_status,
      price_status = EXCLUDED.price_status,
      price_anomaly_status = EXCLUDED.price_anomaly_status,
      price_anomaly_reason = EXCLUDED.price_anomaly_reason,
      is_price_changed = EXCLUDED.is_price_changed,
      warning_flags = EXCLUDED.warning_flags,
      last_seen_at = EXCLUDED.last_seen_at,
      last_batch_at = EXCLUDED.last_batch_at,
      is_active = EXCLUDED.is_active
  `, [JSON.stringify(rows)]);
}

async function insertSnapshots(client, rows) {
  if (!rows.length) return;
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        snapshot_id text, snapshot_key text, source_job_id text, execution_id text,
        collected_at timestamptz, quote_type text, write_fingerprint text, origin text,
        destination_city_id text, depart_date date, return_date date, stay_bucket text,
        traveler text, airline_code text, cabin_group text, tax_included boolean,
        total_price numeric, currency text, normalized_total_krw numeric, fx_rate_source text,
        fx_rate_date text, source_id text, parser_version text, capture_channel text,
        raw_payload_ref text, verification_status text, price_anomaly_status text, expire_at timestamptz
      )
    )
    INSERT INTO fare_snapshots (
      snapshot_id, snapshot_key, source_job_id, execution_id, collected_at, quote_type,
      write_fingerprint, origin, destination_city_id, depart_date, return_date, stay_bucket,
      traveler, airline_code, cabin_group, tax_included, total_price, currency, normalized_total_krw,
      fx_rate_source, fx_rate_date, source_id, parser_version, capture_channel, raw_payload_ref,
      verification_status, price_anomaly_status, expire_at
    )
    SELECT snapshot_id, snapshot_key, source_job_id, execution_id, collected_at, quote_type,
      write_fingerprint, origin, destination_city_id, depart_date, return_date, stay_bucket,
      traveler, airline_code, cabin_group, tax_included, total_price, currency, normalized_total_krw,
      fx_rate_source, fx_rate_date, source_id, parser_version, capture_channel, raw_payload_ref,
      verification_status, price_anomaly_status, expire_at
    FROM input
    ON CONFLICT (snapshot_id) DO NOTHING
  `, [JSON.stringify(rows)]);
}

async function fetchMaterializationOffers(client, groups) {
  const eligibleKeys = [...eligibleBookingSourceKeys(enabledSourceFlagsFromEnv())];
  if (!groups.length || !eligibleKeys.length) return [];
  const rows = [];
  for (const group of groups) {
    const result = await client.query(`
      SELECT
        o.*, p.display_name_ko AS destination_display_name, p.country_code, p.region,
        p.latitude, p.longitude
      FROM offers o
      LEFT JOIN places p ON p.place_id = o.destination_city_id
      WHERE o.origin_airport = $1
        AND o.destination_city_id = $2
        AND o.week = $3
        AND o.stay_bucket = $4
        AND o.traveler = $5
        AND o.is_active = true
        AND COALESCE(o.bookability_status, 'available') <> 'sold_out'
        AND COALESCE(o.price_status, 'active') <> 'sold_out'
        AND COALESCE(o.price_anomaly_status, 'normal') = 'normal'
        AND COALESCE(o.quality_bucket, 'preferred') <> 'excluded'
        AND (
          LOWER(COALESCE(o.booking_source, '')) = ANY($6::text[])
          OR (
            LOWER(COALESCE(o.source_type, '')) <> 'meta_search'
            AND LOWER(COALESCE(o.airline_code, '')) = ANY($6::text[])
          )
        )
    `, [group.origin_airport, group.destination_city_id, group.week, group.stay_bucket, group.traveler, eligibleKeys]);
    rows.push(...result.rows);
  }
  return rows;
}

async function upsertDeals(client, rows) {
  if (!rows.length) return;
  await client.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        deal_id text, materialized_hash text, origin text, traveler text,
        destination_city_id text, destination_display_name text, country_code text,
        region text, week text, stay_bucket text, latitude double precision,
        longitude double precision, economy jsonb, business jsonb, calendar_matrix jsonb,
        warning_flags jsonb, enabled_sources jsonb, is_active boolean
      )
    )
    INSERT INTO deals_current (
      deal_id, schema_version, materialized_hash, origin, traveler, destination_city_id,
      destination_display_name, country_code, region, week, stay_bucket, latitude, longitude,
      economy_min_total_krw, economy_discount_pct, economy_badge_type, economy_price_status,
      economy_best_depart_date, economy_best_return_date, economy_best_offer_id,
      economy_representative_airline, economy_representative_source, economy_deep_link,
      economy_last_seen_at, economy_last_batch_at, business_min_total_krw, business_discount_pct,
      business_badge_type, business_price_status, business_best_depart_date, business_best_return_date,
      business_best_offer_id, business_representative_airline, business_representative_source,
      business_deep_link, business_last_seen_at, business_last_batch_at, calendar_matrix,
      warning_flags, enabled_sources, is_active
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

async function upsertSourceAudit(client, batch, changedRows, allRows) {
  const anomalyCount = allRows.filter((row) => row.price_anomaly_status === "anomaly").length;
  const stats = {
    total_jobs: 1,
    success_count: 1,
    failure_count: 0,
    avg_latency_ms: batch.stats.avg_latency_ms ?? 0,
    block_count: batch.stats.block_count ?? 0,
    schema_validation_failure_count: batch.stats.schema_validation_failed_count ?? 0,
    price_anomaly_count: batch.stats.price_anomaly_count ?? anomalyCount,
    write_amplification_ratio: allRows.length ? changedRows.length / allRows.length : 0,
  };
  await client.query(`
    INSERT INTO source_health (
      source_id, enabled_by_flag, is_paused, circuit_breaker_open, consecutive_failures,
      stats_24h, last_success_at, last_checked_at, last_artifact_prefix
    )
    VALUES ($1, true, false, false, 0, $2::jsonb, $3, $3, $4)
    ON CONFLICT (source_id) DO UPDATE SET
      enabled_by_flag = true,
      is_paused = false,
      circuit_breaker_open = false,
      consecutive_failures = 0,
      stats_24h = EXCLUDED.stats_24h,
      last_success_at = EXCLUDED.last_success_at,
      last_checked_at = EXCLUDED.last_checked_at,
      last_artifact_prefix = EXCLUDED.last_artifact_prefix
  `, [batch.source_id, JSON.stringify(stats), utcTimestamp(batch.collected_at), batch.artifact_prefix ?? null]);

  await client.query(`
    INSERT INTO source_jobs (
      execution_id, source_id, status, parser_version, offers_found, offers_changed,
      snapshots_written, deals_recomputed, schema_validation_failed_count, price_anomaly_count,
      artifact_prefix, started_at, completed_at
    )
    VALUES ($1, $2, 'success', $3, $4, $5, $5, 0, $6, $7, $8, $9, $10)
  `, [
    batch.execution_id,
    batch.source_id,
    batch.parser_version,
    allRows.length,
    changedRows.length,
    batch.stats.schema_validation_failed_count ?? 0,
    batch.stats.price_anomaly_count ?? anomalyCount,
    batch.artifact_prefix ?? null,
    utcTimestamp(batch.stats.started_at ?? batch.collected_at),
    utcTimestamp(batch.stats.completed_at ?? batch.collected_at),
  ]);
}

async function upsertBatchState(client, batch, allRows, currentManifest) {
  const offerHashes = { ...currentManifest };
  for (const row of allRows) offerHashes[row.offer_id] = row.write_fingerprint;
  const lastBatch = {
    status: "success",
    generated_at: new Date().toISOString(),
    last_batch_at: utcTimestamp(batch.collected_at),
    execution_id: batch.execution_id,
    source_id: batch.source_id,
    source_type: batch.source_type,
    parser_version: batch.parser_version,
    offers_found: allRows.length,
  };
  await client.query(`
    INSERT INTO batch_state (key, data)
    VALUES
      ('last_batch', $1::jsonb),
      ('offer_hashes', $2::jsonb)
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data
  `, [JSON.stringify(lastBatch), JSON.stringify(offerHashes)]);
}

export function summarizeCollectorBatch(batch) {
  const offerRows = buildOfferRows(batch);
  return {
    execution_id: batch.execution_id,
    source_id: batch.source_id,
    offers_received: offerRows.length,
    anomaly_offers: offerRows.filter((row) => row.price_anomaly_status === "anomaly").length,
    materializable_groups: new Set(offerRows
      .filter((row) => row.price_anomaly_status === "normal")
      .map((row) => `${row.origin_airport}_${row.destination_city_id}_${row.week}_${row.stay_bucket}_${row.traveler}`)).size,
  };
}

export function collectorDatabaseUrl(options = {}) {
  const env = options.env ?? process.env;
  if (options.connectionString) return options.connectionString;
  if (env.DATABASE_INGEST_URL) return env.DATABASE_INGEST_URL;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (serviceRequiresPostgres(env)) {
    throw new Error("DATABASE_INGEST_URL or DATABASE_URL is required for collector DB writes when SERVICE_REQUIRE_POSTGRES is enabled");
  }
  return DEFAULT_DATABASE_URL;
}

export async function recordCollectorRunBatchState(lastBatch, options = {}) {
  const connectionString = collectorDatabaseUrl(options);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO batch_state (key, data)
      VALUES ('last_batch', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data
    `, [JSON.stringify(lastBatch)]);
    return { status: "recorded", key: "last_batch" };
  } finally {
    await client.end();
  }
}

export function partitionOfferRows(offerRows, currentManifest) {
  const changedRows = offerRows.filter((row) => currentManifest[row.offer_id] !== row.write_fingerprint);
  const unchangedRows = offerRows.filter((row) => currentManifest[row.offer_id] === row.write_fingerprint);
  return { changedRows, unchangedRows };
}

// DATA-20260901-001: 지문이 같아도 재수집됐으면 "보았음"을 갱신한다 — 이 갱신이 없으면
// last_seen_at이 '마지막 변경 시각'으로 퇴화해 fare-freshness 72h 숨김이 살아 있는 재고를 지운다.
export async function touchUnchangedOffers(client, unchangedRows, batch) {
  if (!unchangedRows.length) return 0;
  const seenAt = utcTimestamp(batch.collected_at);
  await client.query(
    "UPDATE offers SET last_seen_at = $1, last_batch_at = $1 WHERE offer_id = ANY($2)",
    [seenAt, unchangedRows.map((row) => row.offer_id)],
  );
  return unchangedRows.length;
}

export async function ingestCollectorBatch(batch, options = {}) {
  const connectionString = collectorDatabaseUrl(options);
  const placeRows = buildPlaceRows(batch);
  const offerRows = buildOfferRows(batch);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const currentManifest = await currentOfferHashes(client);
    const { changedRows, unchangedRows } = partitionOfferRows(offerRows, currentManifest);
    const offersTouched = await touchUnchangedOffers(client, unchangedRows, batch);
    const snapshotRows = buildSnapshotRows(changedRows);
    const groups = [...new Map(changedRows.map((row) => [`${row.origin_airport}_${row.destination_city_id}_${row.week}_${row.stay_bucket}_${row.traveler}`, row])).values()];
    await upsertPlaces(client, placeRows);
    await upsertOffers(client, changedRows);
    await insertSnapshots(client, snapshotRows);
    const materializationOffers = await fetchMaterializationOffers(client, groups);
    const dealRows = buildDealRows(materializationOffers);
    await upsertDeals(client, dealRows);
    await upsertSourceAudit(client, batch, changedRows, offerRows);
    await upsertBatchState(client, batch, offerRows, currentManifest);

    const summary = {
      status: options.rollback ? "rolled_back" : "committed",
      execution_id: batch.execution_id,
      source_id: batch.source_id,
      places_seen: placeRows.length,
      offers_received: offerRows.length,
      offers_changed: changedRows.length,
      offers_touched: offersTouched,
      snapshots_written: snapshotRows.length,
      deals_recomputed: dealRows.length,
      anomaly_offers: offerRows.filter((row) => row.price_anomaly_status === "anomaly").length,
    };
    await client.query(options.rollback ? "ROLLBACK" : "COMMIT");
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

function parseArgs(argv) {
  const args = { rollback: false, dryRun: false, input: "", databaseUrl: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rollback") args.rollback = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    }
    else if (arg === "--input") {
      args.input = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.input) throw new Error("Missing required --input <collector-batch.json>");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const batch = await loadCollectorBatch(args.input);
  if (args.dryRun) {
    console.log(JSON.stringify({ status: "validated", ...summarizeCollectorBatch(batch) }, null, 2));
    return;
  }
  console.log(JSON.stringify(await ingestCollectorBatch(batch, {
    rollback: args.rollback,
    connectionString: args.databaseUrl || undefined,
  }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Collector batch ingest failed.");
    console.error(err);
    process.exit(1);
  });
}
