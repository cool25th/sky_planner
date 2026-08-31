import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";
import { z } from "zod";

import {
  collectorDatabaseUrl,
  ingestCollectorBatch,
  parseCollectorBatch,
  summarizeCollectorBatch,
} from "./ingest-collector-batch.mjs";

const { Client } = pg;

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 8000;
const MAX_RETRY_AFTER_MS = 60000;
const DEFAULT_PARSER_VERSION = "authorized-json-feed-v1";
const MAX_ERROR_LENGTH = 1200;
export const DEEPLINK_VALIDITY_MIN_RATIO = 0.8;

// REQ-COL-004: 소스별 Circuit Breaker 트리거 (연속 실패 3회 공통 규칙에 추가).
// 파트너 계약 만료/긴급 중지는 manifest enabled=false, SOURCE_*_ENABLED 킬스위치, is_paused로 즉시 차단한다.
export const CIRCUIT_BREAKER_FAILURE_THRESHOLDS = [
  { failure_code: "auth_rejected", consecutive: 2 },
  { failure_code: "auth_missing", consecutive: 2 },
  { failure_code: "rate_limited", consecutive: 2 },
  { failure_code: "schema_validation_failed", consecutive: 2 },
  { failure_code: "empty_response", consecutive: 2 },
  { failure_code: "deeplink_validity_drop", consecutive: 1 },
];

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

const SourceTypeSchema = z.enum(["meta_search", "airline_official", "promo_page"]);
const CaptureChannelSchema = z.enum(["xhr", "graphql", "html_state"]);
const CabinSchema = z.enum(["economy", "premium_economy", "business", "first"]);
const PriceStatusSchema = z.enum(["active", "stale", "sold_out"]);
const BookabilityStatusSchema = z.enum(["available", "uncertain", "sold_out"]);
const PriceAnomalySchema = z.enum(["normal", "anomaly"]);

const QueryValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const MappingDefaultsSchema = z.object({
  capture_channel: CaptureChannelSchema.default("xhr"),
  traveler: z.string().default("adt1"),
  booking_source: z.string().optional(),
  source_type: SourceTypeSchema.optional(),
  cabin_group: CabinSchema.default("economy"),
  currency: z.string().default("KRW"),
  tax_included: z.boolean().default(true),
  fx_rate_source: z.string().default("kexim_daily"),
  stop_count: z.number().int().min(0).default(0),
  bookability_status: BookabilityStatusSchema.default("available"),
  price_status: PriceStatusSchema.default("active"),
  quality_bucket: z.enum(["preferred", "acceptable", "degraded", "excluded"]).optional(),
  country_code: z.string().optional(),
  region: z.string().optional(),
}).default({});

const JsonPathMappingSchema = z.object({
  adapter: z.literal("json_path_mapping"),
  collected_at_path: z.string().optional(),
  offers_path: z.string().min(1),
  // dict-of-dicts 응답(예: Travelpayouts cheap {DEST: {idx: offer}})을 rows로 펼친다.
  // 각 depth의 key는 key_fields 순서대로 row 필드로 주입된다.
  flatten_nested: z.object({
    key_fields: z.array(z.string().min(1)).min(1).max(3),
  }).optional(),
  // 코드만 오는 응답(TYO 등)에 정적 메타데이터(한국어 이름·국가·리전·좌표)를 보강한다.
  // drop_unmatched면 lookup에 없는 목적지 행은 버린다(서비스 목적지가 아님).
  places_lookup: z.object({
    key_field: z.string().min(1),
    drop_unmatched: z.boolean().default(false),
    entries: z.record(z.string(), z.object({
      display_name_ko: z.string().min(1),
      display_name_en: z.string().optional(),
      country_code: z.string().min(2),
      region: z.string().min(1),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })),
  }).optional(),
  // 여러 row 경로를 조합한 필드(id, deep_link 등)를 "{path}" 보간으로 구성한다.
  // 필터: {path|date} ISO→YYYY-MM-DD, {path|dmy} ISO/YYYY-MM-DD→DDMM.
  templates: z.record(z.string(), z.string().min(1)).optional(),
  // 정상적으로 빈 응답이 올 수 있는 소스(예: 목적지별 calendar — 현재 데이터 없는 목적지)는
  // 빈 결과를 실패가 아닌 skip으로 처리한다. 기본값 false(설정 버그는 여전히 실패).
  allow_empty: z.boolean().default(false),
  // 체류일이 스키마 stay_bucket(3_4/5_7/8_14) 밖인 행(예: 2박·21박 최저가)은 ingest가 거부하므로
  // 수집 단계에서 미리 버린다. 없으면 통과.
  stay_nights_filter: z.object({
    depart_field: z.string().min(1),
    return_field: z.string().min(1),
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }).optional(),
  defaults: MappingDefaultsSchema,
  fields: z.object({
    id: z.string().optional(),
    capture_channel: z.string().optional(),
    origin_airport: z.string().min(1),
    origin_city_id: z.string().optional(),
    destination_airport: z.string().min(1),
    destination_city_id: z.string().min(1),
    destination_display_name: z.string().min(1),
    destination_display_name_en: z.string().optional(),
    country_code: z.string().optional(),
    region: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    depart_date: z.string().optional(),
    return_date: z.string().optional(),
    week: z.string().optional(),
    stay_nights: z.string().optional(),
    traveler: z.string().optional(),
    airline_code: z.string().min(1),
    airline_name: z.string().min(1),
    operating_airline_code: z.string().optional(),
    operating_airline_name: z.string().optional(),
    booking_source: z.string().optional(),
    source_type: z.string().optional(),
    deep_link: z.string().optional(),
    cabin_group: z.string().optional(),
    cabin_label: z.string().optional(),
    fare_brand: z.string().optional(),
    total_price: z.string().min(1),
    currency: z.string().optional(),
    tax_included: z.string().optional(),
    normalized_total_krw: z.string().optional(),
    fx_rate_source: z.string().optional(),
    fx_rate_date: z.string().optional(),
    stop_count: z.string().optional(),
    departure_time_local: z.string().optional(),
    arrival_time_local: z.string().optional(),
    return_departure_time_local: z.string().optional(),
    return_arrival_time_local: z.string().optional(),
    duration_minutes: z.string().optional(),
    return_duration_minutes: z.string().optional(),
    layover_duration_minutes: z.string().optional(),
    free_baggage_allowance: z.string().optional(),
    seats_left: z.string().optional(),
    is_codeshare: z.string().optional(),
    duration_ratio_vs_direct_baseline: z.string().optional(),
    quality_bucket: z.string().optional(),
    anomaly_status: z.string().optional(),
    anomaly_reason: z.string().optional(),
    warning_flags: z.string().optional(),
    bookability_status: z.string().optional(),
    price_status: z.string().optional(),
    is_price_changed: z.string().optional(),
  }),
}).optional();

const CollectorSourceConfigSchema = z.object({
  schema_version: z.literal("collector.authorized_feed_source.v1"),
  source_id: z.string().min(1),
  source_type: SourceTypeSchema,
  parser_version: z.string().default(DEFAULT_PARSER_VERSION),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  max_retries: z.number().int().min(0).max(10).default(DEFAULT_MAX_RETRIES),
  retry_base_delay_ms: z.number().int().positive().default(DEFAULT_RETRY_BASE_DELAY_MS),
  retry_max_delay_ms: z.number().int().positive().default(DEFAULT_RETRY_MAX_DELAY_MS),
  headers: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), QueryValueSchema).default({}),
  body: z.unknown().optional(),
  artifact_prefix: z.string().optional(),
  response_mapping: JsonPathMappingSchema,
  auth: z.object({
    header_name: z.string().min(1),
    token_env: z.string().min(1),
    value_prefix: z.string().default(""),
  }).optional(),
}).superRefine((config, ctx) => {
  if (config.source_type !== "promo_page" && !config.auth) {
    ctx.addIssue({
      code: "custom",
      path: ["auth"],
      message: "non-promo source requires auth.token_env",
    });
  }
});

const FeedPlaceSchema = z.object({
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

const FeedOfferSchema = z.object({
  id: z.string().min(1),
  raw_payload_ref: z.string().optional(),
  capture_channel: CaptureChannelSchema.default("xhr"),
  origin: z.object({
    airport: z.string().min(3),
    city_id: z.string().optional(),
  }),
  destination: z.object({
    airport: z.string().min(3),
    city_id: z.string().min(3),
    display_name_ko: z.string().min(1),
    display_name_en: z.string().optional(),
    country_code: z.string().min(2),
    region: z.string().min(1),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  dates: z.object({
    depart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    return: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    week: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
    stay_nights: z.number().int().positive().optional(),
  }),
  traveler: z.string().default("adt1"),
  carrier: z.object({
    code: z.string().min(2),
    name: z.string().min(1),
    operating_code: z.string().optional(),
    operating_name: z.string().optional(),
  }),
  source: z.object({
    booking_source: z.string().optional(),
    type: SourceTypeSchema.optional(),
    deep_link: z.string().min(1),
  }),
  cabin: z.object({
    group: z.string().min(1),
    label: z.string().optional(),
    fare_brand: z.string().optional(),
  }),
  price: z.object({
    total: z.number().positive(),
    currency: z.string().default("KRW"),
    tax_included: z.boolean().default(true),
    normalized_total_krw: z.number().positive().optional(),
    fx_rate_source: z.string().default("kexim_daily"),
    fx_rate_date: z.string().optional(),
  }),
  itinerary: z.object({
    stops: z.number().int().min(0).default(0),
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
  }).default({}),
  quality: z.object({
    duration_ratio_vs_direct_baseline: z.number().positive().optional(),
    bucket: z.enum(["preferred", "acceptable", "degraded", "excluded"]).optional(),
    anomaly_status: PriceAnomalySchema.default("normal"),
    anomaly_reason: z.string().optional(),
    warning_flags: z.array(z.string()).default([]),
  }).default({}),
  availability: z.object({
    bookability_status: BookabilityStatusSchema.default("available"),
    price_status: PriceStatusSchema.default("active"),
    is_price_changed: z.boolean().default(false),
  }).default({}),
});

const AuthorizedFeedPayloadSchema = z.object({
  collected_at: z.string().optional(),
  places: z.array(FeedPlaceSchema).default([]),
  offers: z.array(FeedOfferSchema).min(1),
  stats: z.object({
    block_count: z.number().int().min(0).default(0),
    schema_validation_failed_count: z.number().int().min(0).default(0),
    price_anomaly_count: z.number().int().min(0).optional(),
  }).default({}),
});

function parseCollectorSourceConfig(config) {
  return CollectorSourceConfigSchema.parse(config);
}

function utcTimestamp(value) {
  const raw = String(value);
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw}Z`;
  return new Date(raw).toISOString();
}

function compactUtc(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function executionId(sourceId, now) {
  return `${sourceId}_${compactUtc(now)}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isoWeek(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${dateValue}`);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function stayNights(departDate, returnDate, explicit) {
  if (explicit) return explicit;
  const depart = new Date(`${departDate}T00:00:00Z`);
  const ret = new Date(`${returnDate}T00:00:00Z`);
  const nights = Math.round((ret.getTime() - depart.getTime()) / 86400000);
  if (!Number.isFinite(nights) || nights <= 0) throw new Error(`Invalid stay dates: ${departDate} -> ${returnDate}`);
  return nights;
}

function normalizeCabin(value) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CabinSchema.parse(normalized);
}

function getPath(value, rawPath) {
  if (!rawPath || rawPath === "$") return value;
  const segments = rawPath
    .replace(/^\$\./, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

const TEMPLATE_FILTERS = {
  date: (value) => String(value).slice(0, 10),
  dmy: (value) => {
    const date = String(value).slice(0, 10);
    return `${date.slice(8, 10)}${date.slice(5, 7)}`;
  },
  // DATA-20260831-001: 도착 시각 = 출발 시각 + 소요분(같은 행의 다른 필드). 피드가 소요분을
  // 제공하지 않으면 빈 값으로 흘려 필드 생략(있는 데이터만 정직하게 채운다).
  plus_minutes: (value, row, arg) => {
    const minutes = Number(getPath(row, arg));
    const date = new Date(String(value));
    if (!arg || value === undefined || value === null || value === "" || !Number.isFinite(minutes) || Number.isNaN(date.getTime())) {
      return "";
    }
    return new Date(date.getTime() + minutes * 60000).toISOString();
  },
};

function templateValue(template, row, fieldName) {
  return String(template).replace(/\{([^}|]+)(?:\|([a-z_]+)(?::([A-Za-z0-9_]+))?)?\}/g, (_, rawPath, filterName, filterArg) => {
    const value = getPath(row, rawPath.trim());
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing template path ${rawPath} for ${fieldName}`);
    }
    const filter = filterName ? TEMPLATE_FILTERS[filterName] : undefined;
    if (filterName && !filter) throw new Error(`Unknown template filter ${filterName} for ${fieldName}`);
    return String(filter ? filter(value, row, filterArg) : value);
  });
}

function flattenNestedRows(value, keyFields) {
  const [head, ...rest] = keyFields;
  const rows = [];
  for (const [key, inner] of Object.entries(value ?? {})) {
    const children = rest.length
      ? flattenNestedRows(inner, rest)
      : (Array.isArray(inner) ? inner : [inner]);
    for (const child of children) {
      rows.push(child && typeof child === "object" && !Array.isArray(child)
        ? { [head]: key, ...child }
        : { [head]: key, value: child });
    }
  }
  return rows;
}

function mappedValue(row, mapping, fieldName, fallback, required = false) {
  if (mapping.templates && mapping.templates[fieldName] !== undefined) {
    return templateValue(mapping.templates[fieldName], row, fieldName);
  }
  const pathValue = mapping.fields[fieldName] ? getPath(row, mapping.fields[fieldName]) : undefined;
  const value = pathValue ?? fallback;
  if (required && (value === undefined || value === null || value === "")) {
    throw new Error(`Missing required mapped field: ${fieldName}`);
  }
  return value;
}

function stringValue(value, fieldName, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`Missing required mapped field: ${fieldName}`);
    return undefined;
  }
  return String(value);
}

function numberValue(value, fieldName, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`Missing required mapped field: ${fieldName}`);
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric mapped field: ${fieldName}`);
  return parsed;
}

function booleanValue(value, fieldName, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "included"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "excluded"].includes(normalized)) return false;
  throw new Error(`Invalid boolean mapped field: ${fieldName}`);
}

function stringArrayValue(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function rawRefForOffer(artifactPrefix, offersPath, index) {
  const pointer = offersPath
    .replace(/^\$\./, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/");
  return `${artifactPrefix}/raw-source.json#/${pointer}/${index}`;
}

export function mapJsonPathFeedPayload(payload, inputConfig, options = {}) {
  const config = parseCollectorSourceConfig(inputConfig);
  const mapping = config.response_mapping;
  if (!mapping) return payload;

  const offersExtracted = getPath(payload, mapping.offers_path);
  let offersRaw = offersExtracted;
  if (!Array.isArray(offersRaw) && mapping.flatten_nested) {
    offersRaw = flattenNestedRows(offersRaw, mapping.flatten_nested.key_fields);
  }
  if ((!Array.isArray(offersRaw) || !offersRaw.length) && !mapping.allow_empty) {
    throw new Error(`Mapped feed ${config.source_id} produced no offers at ${mapping.offers_path}`);
  }
  if (!Array.isArray(offersRaw)) offersRaw = [];

  // query 파라미터를 행 기본값으로 병합(응답에 origin이 없는 API 대비) 후 places_lookup·stay_nights_filter 적용.
  const lookup = mapping.places_lookup;
  const stayFilter = mapping.stay_nights_filter;
  const resolvedQuery = resolveQueryMonthTokens(config.query, options.now);
  const offersRows = [];
  for (const raw of offersRaw) {
    let row = { ...resolvedQuery, ...raw };
    if (lookup) {
      const entryKey = String(getPath(row, lookup.key_field) ?? "");
      const entry = lookup.entries[entryKey];
      if (entry) row = { ...row, ...entry };
      else if (lookup.drop_unmatched) continue;
    }
    if (stayFilter) {
      const depart = String(getPath(row, stayFilter.depart_field) ?? "").slice(0, 10);
      const ret = String(getPath(row, stayFilter.return_field) ?? "").slice(0, 10);
      const nights = Math.round((Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${depart}T00:00:00Z`)) / 86400000);
      if (!Number.isFinite(nights) || nights < stayFilter.min || nights > stayFilter.max) continue;
    }
    offersRows.push(row);
  }
  if (!offersRows.length && !mapping.allow_empty) {
    throw new Error(`Mapped feed ${config.source_id} produced no offers after places_lookup/stay_nights_filter`);
  }

  const now = options.now ?? new Date();
  const id = options.executionId ?? executionId(config.source_id, now);
  const artifactPrefix = options.artifactPrefix ?? config.artifact_prefix ?? `runtime/collector-artifacts/${id}`;
  const collectedAt = stringValue(
    mapping.collected_at_path ? getPath(payload, mapping.collected_at_path) : undefined,
    "collected_at",
  ) ?? now.toISOString();
  const defaults = mapping.defaults;

  return {
    collected_at: collectedAt,
    places: [],
    offers: offersRows.map((row, index) => ({
      id: stringValue(mappedValue(row, mapping, "id", undefined, true), "id", true),
      raw_payload_ref: rawRefForOffer(artifactPrefix, mapping.offers_path, index),
      capture_channel: stringValue(mappedValue(row, mapping, "capture_channel", defaults.capture_channel), "capture_channel"),
      origin: {
        airport: stringValue(mappedValue(row, mapping, "origin_airport", undefined, true), "origin_airport", true),
        city_id: stringValue(mappedValue(row, mapping, "origin_city_id", undefined), "origin_city_id"),
      },
      destination: {
        airport: stringValue(mappedValue(row, mapping, "destination_airport", undefined, true), "destination_airport", true),
        city_id: stringValue(mappedValue(row, mapping, "destination_city_id", undefined, true), "destination_city_id", true),
        display_name_ko: stringValue(mappedValue(row, mapping, "destination_display_name", undefined, true), "destination_display_name", true),
        display_name_en: stringValue(mappedValue(row, mapping, "destination_display_name_en", undefined), "destination_display_name_en"),
        country_code: stringValue(mappedValue(row, mapping, "country_code", defaults.country_code, true), "country_code", true),
        region: stringValue(mappedValue(row, mapping, "region", defaults.region, true), "region", true),
        latitude: numberValue(mappedValue(row, mapping, "latitude", undefined), "latitude"),
        longitude: numberValue(mappedValue(row, mapping, "longitude", undefined), "longitude"),
      },
      dates: {
        depart: stringValue(mappedValue(row, mapping, "depart_date", undefined, true), "depart_date", true),
        return: stringValue(mappedValue(row, mapping, "return_date", undefined, true), "return_date", true),
        week: stringValue(mappedValue(row, mapping, "week", undefined), "week"),
        stay_nights: numberValue(mappedValue(row, mapping, "stay_nights", undefined), "stay_nights"),
      },
      traveler: stringValue(mappedValue(row, mapping, "traveler", defaults.traveler), "traveler"),
      carrier: {
        code: stringValue(mappedValue(row, mapping, "airline_code", undefined, true), "airline_code", true),
        name: stringValue(mappedValue(row, mapping, "airline_name", undefined, true), "airline_name", true),
        operating_code: stringValue(mappedValue(row, mapping, "operating_airline_code", undefined), "operating_airline_code"),
        operating_name: stringValue(mappedValue(row, mapping, "operating_airline_name", undefined), "operating_airline_name"),
      },
      source: {
        booking_source: stringValue(mappedValue(row, mapping, "booking_source", defaults.booking_source ?? config.source_id), "booking_source"),
        type: stringValue(mappedValue(row, mapping, "source_type", defaults.source_type ?? config.source_type), "source_type"),
        deep_link: stringValue(mappedValue(row, mapping, "deep_link", undefined, true), "deep_link", true),
      },
      cabin: {
        group: stringValue(mappedValue(row, mapping, "cabin_group", defaults.cabin_group), "cabin_group"),
        label: stringValue(mappedValue(row, mapping, "cabin_label", undefined), "cabin_label"),
        fare_brand: stringValue(mappedValue(row, mapping, "fare_brand", undefined), "fare_brand"),
      },
      price: {
        total: numberValue(mappedValue(row, mapping, "total_price", undefined, true), "total_price", true),
        currency: stringValue(mappedValue(row, mapping, "currency", defaults.currency), "currency"),
        tax_included: booleanValue(mappedValue(row, mapping, "tax_included", defaults.tax_included), "tax_included", true),
        normalized_total_krw: numberValue(mappedValue(row, mapping, "normalized_total_krw", undefined), "normalized_total_krw"),
        fx_rate_source: stringValue(mappedValue(row, mapping, "fx_rate_source", defaults.fx_rate_source), "fx_rate_source"),
        fx_rate_date: stringValue(mappedValue(row, mapping, "fx_rate_date", undefined), "fx_rate_date"),
      },
      itinerary: {
        stops: numberValue(mappedValue(row, mapping, "stop_count", defaults.stop_count), "stop_count"),
        departure_time_local: stringValue(mappedValue(row, mapping, "departure_time_local", undefined), "departure_time_local"),
        arrival_time_local: stringValue(mappedValue(row, mapping, "arrival_time_local", undefined), "arrival_time_local"),
        return_departure_time_local: stringValue(mappedValue(row, mapping, "return_departure_time_local", undefined), "return_departure_time_local"),
        return_arrival_time_local: stringValue(mappedValue(row, mapping, "return_arrival_time_local", undefined), "return_arrival_time_local"),
        duration_minutes: numberValue(mappedValue(row, mapping, "duration_minutes", undefined), "duration_minutes"),
        return_duration_minutes: numberValue(mappedValue(row, mapping, "return_duration_minutes", undefined), "return_duration_minutes"),
        layover_duration_minutes: numberValue(mappedValue(row, mapping, "layover_duration_minutes", undefined), "layover_duration_minutes"),
        free_baggage_allowance: stringValue(mappedValue(row, mapping, "free_baggage_allowance", undefined), "free_baggage_allowance"),
        seats_left: numberValue(mappedValue(row, mapping, "seats_left", undefined), "seats_left"),
        is_codeshare: booleanValue(mappedValue(row, mapping, "is_codeshare", false), "is_codeshare", false),
      },
      quality: {
        duration_ratio_vs_direct_baseline: numberValue(mappedValue(row, mapping, "duration_ratio_vs_direct_baseline", undefined), "duration_ratio_vs_direct_baseline"),
        bucket: stringValue(mappedValue(row, mapping, "quality_bucket", defaults.quality_bucket), "quality_bucket"),
        anomaly_status: stringValue(mappedValue(row, mapping, "anomaly_status", "normal"), "anomaly_status"),
        anomaly_reason: stringValue(mappedValue(row, mapping, "anomaly_reason", undefined), "anomaly_reason"),
        warning_flags: stringArrayValue(mappedValue(row, mapping, "warning_flags", [])),
      },
      availability: {
        bookability_status: stringValue(mappedValue(row, mapping, "bookability_status", defaults.bookability_status), "bookability_status"),
        price_status: stringValue(mappedValue(row, mapping, "price_status", defaults.price_status), "price_status"),
        is_price_changed: booleanValue(mappedValue(row, mapping, "is_price_changed", false), "is_price_changed", false),
      },
    })),
    stats: {
      block_count: 0,
      schema_validation_failed_count: 0,
      price_anomaly_count: 0,
    },
  };
}

// RECO-20260828-004: 쿼리 값의 상대 월 토큰 해석 — "{month}", "{month+1}", "{month-2}" → YYYY-MM.
// 정적 매니페스트로 "당월/익월 조회"를 표현하기 위한 것으로 fetch와 행 병합 양쪽에 동일 적용된다.
const MONTH_TOKEN_PATTERN = /\{month([+-]\d+)?\}/g;

export function monthOffsetIso(now = new Date(), delta = 0) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1)).toISOString().slice(0, 7);
}

export function resolveQueryMonthTokens(query, now = new Date()) {
  const resolved = {};
  for (const [key, value] of Object.entries(query)) {
    resolved[key] = typeof value === "string"
      ? value.replace(MONTH_TOKEN_PATTERN, (_, delta) => monthOffsetIso(now, Number(delta ?? 0)))
      : value;
  }
  return resolved;
}

function withQuery(endpoint, query) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url;
}

function jsonHeaders(config) {
  const headers = {
    accept: "application/json",
    "user-agent": "sky-planner-authorized-feed-collector/1.0",
    ...config.headers,
  };
  if (config.method === "POST" && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  if (config.auth) {
    const token = process.env[config.auth.token_env];
    if (!token) throw new Error(`Missing required auth env ${config.auth.token_env}`);
    headers[config.auth.header_name] = `${config.auth.value_prefix}${token}`;
  }
  return headers;
}

export function classifyCollectorFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /aborted|timeout/i.test(message)) return "source_timeout";
  if (/Missing required auth env/i.test(message)) return "auth_missing";
  if (/returned 40[13]/i.test(message)) return "auth_rejected";
  if (/returned 429/i.test(message)) return "rate_limited";
  if (/returned 5\d\d/i.test(message)) return "source_unavailable";
  if (/deep link validity/i.test(message)) return "deeplink_validity_drop";
  if (/produced no offers/i.test(message)) return "empty_response";
  if (/JSON|Unexpected token|not valid JSON/i.test(message)) return "invalid_json";
  if (/ZodError|Invalid input|too_small|invalid_value|expected/i.test(message)) return "schema_validation_failed";
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) return "network_error";
  return "collector_failure";
}

export function isRetryableCollectorError(error) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /aborted|timeout/i.test(message)) return true;
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) return true;
  const statusMatch = message.match(/returned (\d{3})/);
  const status = typeof error?.status === "number" ? error.status : statusMatch ? Number(statusMatch[1]) : null;
  return status !== null && RETRYABLE_HTTP_STATUSES.has(status);
}

export function retryAfterMs(error, nowMs = Date.now()) {
  const raw = error?.retryAfter;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.max(0, parsed - nowMs);
}

export function retryDelayMs(attempt, options = {}) {
  const baseDelayMs = options.retry_base_delay_ms ?? options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelayMs = options.retry_max_delay_ms ?? options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  const exponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

export function shouldOpenCircuitBreaker({ consecutive_failures = 0, recent_failure_codes = [] } = {}) {
  if (consecutive_failures >= 3) return true;
  return CIRCUIT_BREAKER_FAILURE_THRESHOLDS.some((rule) => {
    const recent = recent_failure_codes.slice(0, rule.consecutive);
    return recent.length === rule.consecutive && recent.every((code) => code === rule.failure_code);
  });
}

export function deeplinkValidityRatio(batch) {
  const offers = Array.isArray(batch?.offers) ? batch.offers : [];
  if (!offers.length) return 1;
  const valid = offers.filter((offer) => {
    try {
      const url = new URL(String(offer.deep_link ?? ""));
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }).length;
  return valid / offers.length;
}

function errorMessage(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export async function recordCollectorFailure(inputConfig, error, options = {}) {
  const config = parseCollectorSourceConfig(inputConfig);
  const connectionString = collectorDatabaseUrl(options);
  const now = options.now ?? new Date();
  const startedAt = utcTimestamp(options.startedAt ?? now.toISOString());
  const completedAt = utcTimestamp(options.completedAt ?? now.toISOString());
  const failureCode = options.failureCode ?? classifyCollectorFailure(error);
  const execution = options.executionId ?? executionId(config.source_id, now);
  const stats = {
    total_jobs: 1,
    success_count: 0,
    failure_count: 1,
    avg_latency_ms: Math.max(0, Number(options.latencyMs ?? 0)),
    block_count: failureCode === "rate_limited" ? 1 : 0,
    schema_validation_failure_count: failureCode === "schema_validation_failed" ? 1 : 0,
    price_anomaly_count: 0,
    write_amplification_ratio: 0,
  };
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO source_jobs (
        execution_id, source_id, status, parser_version, offers_found, offers_changed,
        snapshots_written, deals_recomputed, schema_validation_failed_count, price_anomaly_count,
        failure_code, last_error, artifact_prefix, started_at, completed_at
      )
      VALUES ($1, $2, 'failed', $3, 0, 0, 0, 0, $4, 0, $5, $6, $7, $8, $9)
    `, [
      execution,
      config.source_id,
      config.parser_version,
      failureCode === "schema_validation_failed" ? 1 : 0,
      failureCode,
      errorMessage(error),
      options.artifactPrefix ?? config.artifact_prefix ?? null,
      startedAt,
      completedAt,
    ]);

    const { rows: recentRows } = await client.query(`
      SELECT failure_code FROM source_jobs
      WHERE source_id = $1 AND status = 'failed'
      ORDER BY created_at DESC
      LIMIT 5
    `, [config.source_id]);
    const recentFailureCodes = recentRows.map((row) => String(row.failure_code ?? "")).filter(Boolean);

    const { rows } = await client.query(`
      INSERT INTO source_health (
        source_id, enabled_by_flag, stats_24h, last_failure_at, last_failure_code,
        last_checked_at, last_artifact_prefix, consecutive_failures, circuit_breaker_open
      )
      VALUES ($1, true, $2::jsonb, $3, $4, $3, $5, 1, false)
      ON CONFLICT (source_id) DO UPDATE SET
        enabled_by_flag = true,
        stats_24h = EXCLUDED.stats_24h,
        last_failure_at = EXCLUDED.last_failure_at,
        last_failure_code = EXCLUDED.last_failure_code,
        last_checked_at = EXCLUDED.last_checked_at,
        last_artifact_prefix = EXCLUDED.last_artifact_prefix,
        consecutive_failures = source_health.consecutive_failures + 1,
        circuit_breaker_open = (source_health.consecutive_failures + 1) >= 3
      RETURNING consecutive_failures, circuit_breaker_open
    `, [
      config.source_id,
      JSON.stringify(stats),
      completedAt,
      failureCode,
      options.artifactPrefix ?? config.artifact_prefix ?? null,
    ]);

    const breakerOpen = shouldOpenCircuitBreaker({
      consecutive_failures: Number(rows[0]?.consecutive_failures ?? 1),
      recent_failure_codes: recentFailureCodes,
    });
    const circuitBreakerOpen = breakerOpen || Boolean(rows[0]?.circuit_breaker_open);
    if (breakerOpen && !rows[0]?.circuit_breaker_open) {
      await client.query(
        "UPDATE source_health SET circuit_breaker_open = true WHERE source_id = $1",
        [config.source_id],
      );
    }

    const summary = {
      status: options.rollback ? "failure_audit_rolled_back" : "failure_audited",
      execution_id: execution,
      source_id: config.source_id,
      failure_code: failureCode,
      consecutive_failures: Number(rows[0]?.consecutive_failures ?? 1),
      circuit_breaker_open: circuitBreakerOpen,
    };
    await client.query(options.rollback ? "ROLLBACK" : "COMMIT");
    return summary;
  } catch (auditError) {
    await client.query("ROLLBACK");
    throw auditError;
  } finally {
    await client.end();
  }
}

export async function loadCollectorConfig(configPath) {
  const payload = JSON.parse(await readFile(configPath, "utf-8"));
  return parseCollectorSourceConfig(payload);
}

function feedHttpError(config, response, text) {
  const error = new Error(`Authorized feed ${config.source_id} returned ${response.status}: ${text.slice(0, 300)}`);
  error.status = response.status;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
}

export async function fetchAuthorizedFeed(inputConfig, options = {}) {
  const config = parseCollectorSourceConfig(inputConfig);
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  const url = withQuery(config.endpoint, resolveQueryMonthTokens(config.query, options.now ?? new Date()));
  const headers = jsonHeaders(config);
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
    try {
      const response = await fetch(url, {
        method: config.method,
        headers,
        body: config.method === "POST" ? JSON.stringify(config.body ?? {}) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw feedHttpError(config, response, text);
      }
      return {
        payload: JSON.parse(text),
        status: response.status,
        latency_ms: Date.now() - started,
        content_hash: sha256(text),
        url: url.toString(),
        attempts: attempt + 1,
      };
    } catch (err) {
      if (attempt >= config.max_retries || !isRetryableCollectorError(err)) throw err;
      const after = retryAfterMs(err);
      const delay = after !== null ? Math.min(after, MAX_RETRY_AFTER_MS) : retryDelayMs(attempt, config);
      await sleep(delay);
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeAuthorizedFeedPayload(payload, inputConfig, options = {}) {
  const config = parseCollectorSourceConfig(inputConfig);
  const normalizedPayload = mapJsonPathFeedPayload(payload, config, options);
  if (!normalizedPayload.offers.length && config.response_mapping?.allow_empty) {
    return null;
  }
  const feed = AuthorizedFeedPayloadSchema.parse(normalizedPayload);
  const now = options.now ?? new Date();
  const id = options.executionId ?? executionId(config.source_id, now);
  const collectedAt = feed.collected_at ?? now.toISOString();
  const artifactPrefix = options.artifactPrefix ?? config.artifact_prefix ?? `runtime/collector-artifacts/${id}`;
  const rawRefBase = `${artifactPrefix}/raw-source.json`;

  return parseCollectorBatch({
    schema_version: "collector.normalized_batch.v1",
    execution_id: id,
    source_id: config.source_id,
    source_type: config.source_type,
    parser_version: config.parser_version,
    schema_validator: "authorized-feed-collector-v1",
    collected_at: collectedAt,
    artifact_prefix: artifactPrefix,
    places: feed.places,
    offers: feed.offers.map((offer, index) => ({
      source_offer_id: offer.id,
      raw_payload_ref: offer.raw_payload_ref ?? `${rawRefBase}#/offers/${index}`,
      capture_channel: offer.capture_channel,
      origin_airport: offer.origin.airport,
      origin_city_id: offer.origin.city_id ?? offer.origin.airport,
      destination_airport: offer.destination.airport,
      destination_city_id: offer.destination.city_id,
      destination_display_name: offer.destination.display_name_ko,
      destination_display_name_en: offer.destination.display_name_en,
      country_code: offer.destination.country_code,
      region: offer.destination.region,
      latitude: offer.destination.latitude,
      longitude: offer.destination.longitude,
      depart_date: offer.dates.depart,
      return_date: offer.dates.return,
      stay_nights: stayNights(offer.dates.depart, offer.dates.return, offer.dates.stay_nights),
      week: offer.dates.week ?? isoWeek(offer.dates.depart),
      traveler: offer.traveler,
      airline_code: offer.carrier.code,
      airline_name: offer.carrier.name,
      operating_airline_code: offer.carrier.operating_code,
      operating_airline_name: offer.carrier.operating_name,
      booking_source: offer.source.booking_source ?? config.source_id,
      source_type: offer.source.type ?? config.source_type,
      cabin_group: normalizeCabin(offer.cabin.group),
      cabin_label_raw: offer.cabin.label,
      fare_brand_raw: offer.cabin.fare_brand,
      total_price: offer.price.total,
      currency: offer.price.currency,
      tax_included: offer.price.tax_included,
      normalized_total_krw: offer.price.normalized_total_krw ?? offer.price.total,
      fx_rate_source: offer.price.fx_rate_source,
      fx_rate_date: offer.price.fx_rate_date,
      stop_count: offer.itinerary.stops,
      departure_time_local: offer.itinerary.departure_time_local,
      arrival_time_local: offer.itinerary.arrival_time_local,
      return_departure_time_local: offer.itinerary.return_departure_time_local,
      return_arrival_time_local: offer.itinerary.return_arrival_time_local,
      duration_minutes: offer.itinerary.duration_minutes,
      return_duration_minutes: offer.itinerary.return_duration_minutes,
      layover_duration_minutes: offer.itinerary.layover_duration_minutes,
      free_baggage_allowance: offer.itinerary.free_baggage_allowance,
      seats_left: offer.itinerary.seats_left,
      is_codeshare: offer.itinerary.is_codeshare,
      duration_ratio_vs_direct_baseline: offer.quality.duration_ratio_vs_direct_baseline,
      quality_bucket: offer.quality.bucket,
      price_anomaly_status: offer.quality.anomaly_status,
      price_anomaly_reason: offer.quality.anomaly_reason,
      deep_link: offer.source.deep_link,
      bookability_status: offer.availability.bookability_status,
      price_status: offer.availability.price_status,
      is_price_changed: offer.availability.is_price_changed,
      warning_flags: offer.quality.warning_flags,
      last_seen_at: collectedAt,
    })),
    stats: {
      ...feed.stats,
      started_at: options.startedAt ?? collectedAt,
      completed_at: options.completedAt ?? collectedAt,
      avg_latency_ms: options.latencyMs ?? 0,
    },
  });
}

export async function collectAuthorizedFeed(inputConfig, options = {}) {
  const config = parseCollectorSourceConfig(inputConfig);
  const startedAt = new Date();
  const result = await fetchAuthorizedFeed(config, { sleep: options.sleep });
  const completedAt = new Date();
  const batch = normalizeAuthorizedFeedPayload(result.payload, config, {
    now: options.now ?? completedAt,
    executionId: options.executionId,
    artifactPrefix: options.artifactPrefix,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: result.latency_ms,
  });
  if (batch === null) {
    return {
      no_offers: true,
      batch: null,
      raw_payload: result.payload,
      fetch_summary: {
        status: result.status,
        latency_ms: result.latency_ms,
        attempts: result.attempts,
        content_hash: result.content_hash,
        url: result.url,
      },
    };
  }
  const deeplinkRatio = deeplinkValidityRatio(batch);
  if (deeplinkRatio < DEEPLINK_VALIDITY_MIN_RATIO) {
    throw new Error(
      `Deep link validity dropped to ${deeplinkRatio.toFixed(2)} for ${config.source_id} (minimum ${DEEPLINK_VALIDITY_MIN_RATIO})`,
    );
  }
  return {
    batch,
    raw_payload: result.payload,
    fetch_summary: {
      status: result.status,
      latency_ms: result.latency_ms,
      attempts: result.attempts,
      content_hash: result.content_hash,
      deeplink_validity_ratio: deeplinkRatio,
      url: result.url,
    },
  };
}

export async function writeCollectorArtifacts(batch, rawPayload, options = {}) {
  const artifactDir = options.artifactDir ?? batch.artifact_prefix ?? `runtime/collector-artifacts/${batch.execution_id}`;
  const rawPath = options.rawOutput ?? path.join(artifactDir, "raw-source.json");
  const batchPath = options.output ?? path.join(artifactDir, "normalized-batch.json");
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(batchPath), { recursive: true });
  await writeFile(rawPath, `${JSON.stringify(rawPayload, null, 2)}\n`);
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
  return { raw_output: rawPath, output: batchPath };
}

function parseArgs(argv) {
  const args = {
    config: "",
    output: "",
    rawOutput: "",
    artifactDir: "",
    databaseUrl: "",
    ingest: false,
    rollback: false,
    auditFailure: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      args.config = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--raw-output") {
      args.rawOutput = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--artifact-dir") {
      args.artifactDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--ingest") {
      args.ingest = true;
    } else if (arg === "--rollback") {
      args.rollback = true;
      args.ingest = true;
    } else if (arg === "--audit-failure") {
      args.auditFailure = true;
    } else if (arg === "--dry-run") {
      args.ingest = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.config) throw new Error("Missing required --config <authorized-feed-source.json>");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadCollectorConfig(args.config);
  const startedAt = new Date();
  try {
    const { batch, raw_payload, fetch_summary } = await collectAuthorizedFeed(config);
    const artifacts = await writeCollectorArtifacts(batch, raw_payload, {
      artifactDir: args.artifactDir || undefined,
      output: args.output || undefined,
      rawOutput: args.rawOutput || undefined,
    });
    const summary = args.ingest
      ? await ingestCollectorBatch(batch, {
        connectionString: args.databaseUrl || undefined,
        rollback: args.rollback,
      })
      : { status: "validated", ...summarizeCollectorBatch(batch) };

    console.log(JSON.stringify({
      ...summary,
      fetch_summary,
      artifacts,
    }, null, 2));
  } catch (err) {
    if (args.auditFailure) {
      const audit = await recordCollectorFailure(config, err, {
        connectionString: args.databaseUrl || undefined,
        rollback: args.rollback,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      });
      console.error(JSON.stringify(audit, null, 2));
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Authorized feed collector failed.");
    console.error(err);
    process.exit(1);
  });
}
