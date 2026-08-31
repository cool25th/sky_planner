import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyCollectorFailure,
  collectAuthorizedFeed,
  deeplinkValidityRatio,
  isRetryableCollectorError,
  loadCollectorConfig,
  mapJsonPathFeedPayload,
  normalizeAuthorizedFeedPayload,
  retryAfterMs,
  retryDelayMs,
  shouldOpenCircuitBreaker,
  writeCollectorArtifacts,
} from "../scripts/run-authorized-feed-collector.mjs";

const fixturePath = new URL("./fixtures/authorized-feed-response.sample.json", import.meta.url);
const mappedFixturePath = new URL("./fixtures/mapped-partner-feed.sample.json", import.meta.url);
const fixtureJson = await readFile(fixturePath, "utf-8");

async function withFixtureServer(handler) {
  const fixture = await readFile(fixturePath, "utf-8");
  let lastRequest = null;
  const server = createServer((req, res) => {
    lastRequest = req;
    if (req.url?.startsWith("/fares")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await handler({
      endpoint: `http://127.0.0.1:${address.port}/fares`,
      lastRequest: () => lastRequest,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function baseConfig(endpoint) {
  return {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: "authorized_partner_feed",
    source_type: "meta_search",
    parser_version: "authorized-json-feed-test-v1",
    endpoint,
    method: "GET",
    query: {
      origin: "ICN",
      destination: "TYO",
      cabin: "ALL",
    },
    auth: {
      header_name: "x-api-key",
      token_env: "AUTHORIZED_FEED_TEST_TOKEN",
    },
  };
}

function mappedConfig(endpoint) {
  return {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: "mapped_partner_feed",
    source_type: "meta_search",
    parser_version: "json-path-mapping-test-v1",
    endpoint,
    method: "GET",
    auth: {
      header_name: "x-api-key",
      token_env: "AUTHORIZED_FEED_TEST_TOKEN",
    },
    response_mapping: {
      adapter: "json_path_mapping",
      collected_at_path: "meta.collectedAt",
      offers_path: "data.quotes",
      defaults: {
        traveler: "adt1",
        currency: "KRW",
        tax_included: true,
        fx_rate_source: "kexim_daily",
        bookability_status: "available",
        price_status: "active",
      },
      fields: {
        id: "quoteId",
        origin_airport: "from",
        origin_city_id: "fromCity",
        destination_airport: "toAirport",
        destination_city_id: "toCity",
        destination_display_name: "toNameKo",
        destination_display_name_en: "toNameEn",
        country_code: "country",
        region: "region",
        latitude: "lat",
        longitude: "lon",
        depart_date: "depart",
        return_date: "return",
        week: "week",
        stay_nights: "nights",
        airline_code: "airline.code",
        airline_name: "airline.name",
        booking_source: "bookingSource",
        source_type: "sourceType",
        deep_link: "bookingUrl",
        cabin_group: "cabin",
        fare_brand: "fareBrand",
        total_price: "totalKrw",
        tax_included: "taxIncluded",
        stop_count: "stops",
        duration_minutes: "durationMinutes",
        return_duration_minutes: "returnDurationMinutes",
        free_baggage_allowance: "baggage",
        seats_left: "seatsLeft",
        warning_flags: "warnings",
      },
    },
  };
}

test("authorized feed collector fetches, normalizes, and preserves raw artifact refs", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  await withFixtureServer(async ({ endpoint, lastRequest }) => {
    const config = baseConfig(endpoint);
    const { batch, fetch_summary } = await collectAuthorizedFeed(config, {
      executionId: "authorized_partner_feed_test_20260525T021000Z",
      artifactPrefix: "runtime/collector-artifacts/test-authorized-feed",
    });

    assert.equal(lastRequest().headers["x-api-key"], "test-token");
    assert.match(lastRequest().url, /origin=ICN/);
    assert.equal(fetch_summary.status, 200);
    assert.match(fetch_summary.content_hash, /^[a-f0-9]{64}$/);

    assert.equal(batch.schema_version, "collector.normalized_batch.v1");
    assert.equal(batch.source_id, "authorized_partner_feed");
    assert.equal(batch.parser_version, "authorized-json-feed-test-v1");
    assert.equal(batch.offers.length, 2);
    assert.equal(batch.offers[0].source_offer_id, "partner-ke-tyo-economy-001");
    assert.equal(batch.offers[0].destination_city_id, "TYO");
    assert.equal(batch.offers[0].week, "2026-W15");
    assert.equal(batch.offers[0].stay_nights, 5);
    assert.equal(batch.offers[0].cabin_group, "economy");
    assert.equal(batch.offers[0].booking_source, "korean_air_official");
    assert.equal(batch.offers[0].raw_payload_ref, "runtime/collector-artifacts/test-authorized-feed/raw-source.json#/offers/0");
    assert.equal(batch.offers[1].capture_channel, "graphql");
    assert.equal(batch.offers[1].cabin_group, "business");
  });
});

test("authorized feed config can be loaded from disk and artifacts are written", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-feed-"));
  try {
    await withFixtureServer(async ({ endpoint }) => {
      const configPath = path.join(tmpDir, "source.json");
      await writeFile(configPath, `${JSON.stringify(baseConfig(endpoint), null, 2)}\n`);
      const config = await loadCollectorConfig(configPath);
      const { batch, raw_payload } = await collectAuthorizedFeed(config, {
        executionId: "authorized_partner_feed_artifact_test",
        artifactPrefix: "runtime/collector-artifacts/artifact-test",
      });
      const artifacts = await writeCollectorArtifacts(batch, raw_payload, {
        artifactDir: tmpDir,
      });

      const normalized = JSON.parse(await readFile(artifacts.output, "utf-8"));
      const raw = JSON.parse(await readFile(artifacts.raw_output, "utf-8"));
      assert.equal(normalized.execution_id, "authorized_partner_feed_artifact_test");
      assert.equal(raw.offers.length, 2);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("json-path mapped partner feed normalizes into collector batch schema", async () => {
  const payload = JSON.parse(await readFile(mappedFixturePath, "utf-8"));
  const config = mappedConfig("http://127.0.0.1:1/fares");
  const mapped = mapJsonPathFeedPayload(payload, config, {
    executionId: "mapped_partner_test_20260525T022000Z",
    artifactPrefix: "runtime/collector-artifacts/mapped-partner-test",
  });
  const batch = normalizeAuthorizedFeedPayload(payload, config, {
    executionId: "mapped_partner_test_20260525T022000Z",
    artifactPrefix: "runtime/collector-artifacts/mapped-partner-test",
  });

  assert.equal(mapped.collected_at, "2026-05-25T02:20:00Z");
  assert.equal(batch.source_id, "mapped_partner_feed");
  assert.equal(batch.parser_version, "json-path-mapping-test-v1");
  assert.equal(batch.offers.length, 2);
  assert.equal(batch.offers[0].source_offer_id, "raw-partner-tyo-economy-001");
  assert.equal(batch.offers[0].destination_city_id, "TYO");
  assert.equal(batch.offers[0].week, "2026-W15");
  assert.equal(batch.offers[0].stay_nights, 5);
  assert.equal(batch.offers[0].cabin_group, "economy");
  assert.equal(batch.offers[0].total_price, 312000);
  assert.equal(batch.offers[0].free_baggage_allowance, "1PC");
  assert.deepEqual(batch.offers[0].warning_flags, ["tax_included_total"]);
  assert.equal(batch.offers[0].raw_payload_ref, "runtime/collector-artifacts/mapped-partner-test/raw-source.json#/data/quotes/0");
  assert.equal(batch.offers[1].cabin_group, "business");
  assert.equal(batch.offers[1].total_price, 1180000);
  assert.deepEqual(batch.offers[1].warning_flags, ["final_price_check_on_booking_source"]);
});

test("json-path mapped partner feed fails fast when no offers are found", async () => {
  const payload = JSON.parse(await readFile(mappedFixturePath, "utf-8"));
  const config = mappedConfig("http://127.0.0.1:1/fares");
  config.response_mapping.offers_path = "data.missingQuotes";

  assert.throws(() => mapJsonPathFeedPayload(payload, config), /produced no offers/);
});

test("authorized feed config requires auth for non-promo sources", async () => {
  const payload = JSON.parse(await readFile(mappedFixturePath, "utf-8"));
  const config = mappedConfig("http://127.0.0.1:1/fares");
  delete config.auth;

  assert.throws(
    () => mapJsonPathFeedPayload(payload, config),
    /non-promo source requires auth\.token_env/,
  );
});

test("authorized feed config allows promo page sources without auth", async () => {
  const payload = JSON.parse(await readFile(mappedFixturePath, "utf-8"));
  const config = mappedConfig("http://127.0.0.1:1/fares");
  config.source_type = "promo_page";
  delete config.auth;

  const mapped = mapJsonPathFeedPayload(payload, config, {
    executionId: "mapped_promo_page_test_20260525T022000Z",
    artifactPrefix: "runtime/collector-artifacts/mapped-promo-page-test",
  });

  assert.equal(mapped.offers.length, 2);
});

test("authorized feed collector rejects non-success HTTP responses", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "maintenance" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const config = {
      ...baseConfig(`http://127.0.0.1:${port}/fares`),
      max_retries: 0,
    };
    process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
    await assert.rejects(() => collectAuthorizedFeed(config), /returned 503/);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("authorized feed failure classifier maps operational failure codes", () => {
  assert.equal(classifyCollectorFailure(new Error("Missing required auth env PARTNER_TOKEN")), "auth_missing");
  assert.equal(classifyCollectorFailure(new Error("Authorized feed partner returned 401: unauthorized")), "auth_rejected");
  assert.equal(classifyCollectorFailure(new Error("Authorized feed partner returned 429: too many requests")), "rate_limited");
  assert.equal(classifyCollectorFailure(new Error("Authorized feed partner returned 503: maintenance")), "source_unavailable");
  assert.equal(classifyCollectorFailure(new SyntaxError("Unexpected token '<', not valid JSON")), "invalid_json");
  assert.equal(classifyCollectorFailure(new Error("fetch failed: ECONNRESET")), "network_error");
  assert.equal(classifyCollectorFailure(new Error("Mapped feed partner produced no offers at data.quotes")), "empty_response");
  assert.equal(classifyCollectorFailure(new Error("Deep link validity dropped to 0.50 for partner (minimum 0.8)")), "deeplink_validity_drop");
});

test("authorized feed collector retries transient failures with exponential backoff and jitter", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  const sleeps = [];
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    if (requests < 3) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "transient" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(fixtureJson);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const config = {
      ...baseConfig(`http://127.0.0.1:${port}/fares`),
      max_retries: 3,
      retry_base_delay_ms: 400,
      retry_max_delay_ms: 5000,
    };
    const { fetch_summary } = await collectAuthorizedFeed(config, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(requests, 3);
    assert.equal(fetch_summary.attempts, 3);
    assert.equal(sleeps.length, 2);
    for (const [index, delay] of sleeps.entries()) {
      const exponential = Math.min(400 * 2 ** index, 5000);
      assert.ok(delay >= exponential / 2 && delay <= exponential, `delay ${delay} within jitter band for attempt ${index}`);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("authorized feed collector honors Retry-After on 429 responses", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  const sleeps = [];
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    if (requests === 1) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
      res.end(JSON.stringify({ error: "slow_down" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(fixtureJson);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const config = {
      ...baseConfig(`http://127.0.0.1:${port}/fares`),
      max_retries: 3,
    };
    const { fetch_summary } = await collectAuthorizedFeed(config, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(requests, 2);
    assert.deepEqual(sleeps, [7000]);
    assert.equal(fetch_summary.attempts, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("authorized feed collector does not retry non-retryable client errors", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const config = {
      ...baseConfig(`http://127.0.0.1:${port}/fares`),
      max_retries: 3,
    };
    await assert.rejects(
      () => collectAuthorizedFeed(config, { sleep: async () => {} }),
      /returned 401/,
    );
    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("authorized feed retry policy classifies retryable errors and delays", () => {
  assert.equal(isRetryableCollectorError(new Error("Authorized feed p returned 429: slow down")), true);
  assert.equal(isRetryableCollectorError(new Error("Authorized feed p returned 503: maintenance")), true);
  assert.equal(isRetryableCollectorError(new Error("Authorized feed p returned 401: denied")), false);
  assert.equal(isRetryableCollectorError(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(isRetryableCollectorError(new SyntaxError("Unexpected token, not valid JSON")), false);

  const rateLimited = new Error("Authorized feed p returned 429");
  rateLimited.retryAfter = "2";
  assert.equal(retryAfterMs(rateLimited), 2000);
  const dateBased = new Error("Authorized feed p returned 429");
  dateBased.retryAfter = new Date(Date.now() + 5000).toUTCString();
  const parsed = retryAfterMs(dateBased);
  assert.ok(parsed !== null && parsed > 4000 && parsed <= 5000);
  assert.equal(retryAfterMs(new Error("no header")), null);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const delay = retryDelayMs(attempt, { retry_base_delay_ms: 500, retry_max_delay_ms: 4000 });
    const exponential = Math.min(500 * 2 ** attempt, 4000);
    assert.ok(delay >= exponential / 2 && delay <= exponential);
  }
});

test("circuit breaker opens on reason-specific consecutive failures", () => {
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 3, recent_failure_codes: [] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 2, recent_failure_codes: ["auth_rejected", "auth_rejected"] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 2, recent_failure_codes: ["rate_limited", "rate_limited"] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 2, recent_failure_codes: ["schema_validation_failed", "schema_validation_failed"] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 2, recent_failure_codes: ["empty_response", "empty_response"] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 1, recent_failure_codes: ["deeplink_validity_drop"] }), true);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 2, recent_failure_codes: ["auth_rejected", "source_timeout"] }), false);
  assert.equal(shouldOpenCircuitBreaker({ consecutive_failures: 1, recent_failure_codes: ["source_timeout"] }), false);
  assert.equal(shouldOpenCircuitBreaker(), false);
});

test("authorized feed collector rejects batches with collapsed deep link validity", async () => {
  process.env.AUTHORIZED_FEED_TEST_TOKEN = "test-token";
  const payload = JSON.parse(fixtureJson);
  payload.offers[0].source.deep_link = "http://insecure-partner.example/booking";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const config = baseConfig(`http://127.0.0.1:${port}/fares`);
    await assert.rejects(
      () => collectAuthorizedFeed(config, { sleep: async () => {} }),
      /Deep link validity dropped/,
    );
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("deep link validity ratio counts only https links", () => {
  const batch = {
    offers: [
      { deep_link: "https://partner.example/a" },
      { deep_link: "https://partner.example/b" },
      { deep_link: "http://partner.example/c" },
      { deep_link: "not-a-url" },
    ],
  };
  assert.equal(deeplinkValidityRatio(batch), 0.5);
  assert.equal(deeplinkValidityRatio({ offers: [] }), 1);
});

test("authorized feed normalization rejects invalid fares before ingest", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf-8"));
  payload.offers[0].price.total = 0;
  const config = baseConfig("http://127.0.0.1:1/fares");

  assert.throws(
    () => normalizeAuthorizedFeedPayload(payload, config, { executionId: "invalid_fare_test" }),
    /total/,
  );
});

// DATA-20260818-003: Travelpayouts cheap 응답(dict-of-dicts) 매핑 — flatten·places_lookup·templates·stay_nights_filter 계약.
test("json_path mapping flattens nested cheap-shaped feeds with places lookup and templates", () => {
  const config = {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: "travelpayouts_aviasales_test",
    source_type: "meta_search",
    endpoint: "https://api.example.test/cheap",
    auth: { header_name: "X-Access-Token", token_env: "TEST_TOKEN" },
    query: { origin: "ICN", currency: "krw" },
    response_mapping: {
      adapter: "json_path_mapping",
      offers_path: "data",
      flatten_nested: { key_fields: ["destination_city_id", "offer_index"] },
      places_lookup: {
        key_field: "destination_city_id",
        drop_unmatched: true,
        entries: {
          TYO: { display_name_ko: "도쿄", display_name_en: "Tokyo", country_code: "JP", region: "JAPAN", latitude: 35.6762, longitude: 139.6503 },
        },
      },
      templates: {
        id: "tp_{destination_city_id}_{offer_index}_{departure_at|date}",
        depart_date: "{departure_at|date}",
        return_date: "{return_at|date}",
        deep_link: "https://www.aviasales.com/search/{origin}{destination_city_id}{departure_at|dmy}{return_at|dmy}1?marker=TEST",
        arrival_time_local: "{departure_at|plus_minutes:duration_to}",
        return_arrival_time_local: "{return_at|plus_minutes:duration_back}",
      },
      stay_nights_filter: { depart_field: "departure_at", return_field: "return_at", min: 3, max: 14 },
      defaults: { booking_source: "travelpayouts_aviasales" },
      fields: {
        origin_airport: "origin",
        destination_airport: "destination_city_id",
        destination_city_id: "destination_city_id",
        destination_display_name: "display_name_ko",
        country_code: "country_code",
        region: "region",
        latitude: "latitude",
        longitude: "longitude",
        airline_code: "airline",
        airline_name: "airline",
        total_price: "price",
        duration_minutes: "duration",
        departure_time_local: "departure_at",
        return_departure_time_local: "return_at",
      },
    },
  };
  const payload = {
    data: {
      TYO: { 1: { airline: "7C", departure_at: "2026-10-12T07:10:00+09:00", return_at: "2026-10-16T12:50:00+09:00", price: 363285, duration: 310, duration_to: 185, duration_back: 200 } },
      ADL: { 2: { airline: "GA", departure_at: "2027-01-08T10:35:00+09:00", return_at: "2027-01-10T06:05:00+10:30", price: 1465987, duration: 3530 } },
      PAR: { 1: { airline: "KE", departure_at: "2026-10-12T10:00:00+09:00", return_at: "2026-10-13T10:00:00+09:00", price: 900000, duration: 700 } },
    },
  };

  const result = mapJsonPathFeedPayload(payload, config, { now: new Date("2026-08-28T00:00:00Z") });

  assert.equal(result.offers.length, 1, "ADL(미등록 목적지)·PAR(1박, 버킷 밖)은 버려야 한다");
  const offer = result.offers[0];
  assert.equal(offer.origin.airport, "ICN");
  assert.equal(offer.destination.city_id, "TYO");
  assert.equal(offer.destination.display_name_ko, "도쿄");
  assert.equal(offer.destination.country_code, "JP");
  assert.equal(offer.destination.latitude, 35.6762);
  assert.equal(offer.dates.depart, "2026-10-12");
  assert.equal(offer.dates.return, "2026-10-16");
  assert.equal(offer.id, "tp_TYO_1_2026-10-12");
  assert.equal(offer.source.deep_link, "https://www.aviasales.com/search/ICNTYO121016101?marker=TEST");
  assert.equal(offer.source.booking_source, "travelpayouts_aviasales");
  assert.equal(offer.carrier.code, "7C");
  assert.equal(offer.price.total, 363285);
  assert.equal(offer.itinerary.duration_minutes, 310);
  // DATA-20260831-001: 다리 시각 매핑 — 출발은 원문 통과, 도착은 출발+소요분(plus_minutes) 산술.
  assert.equal(offer.itinerary.departure_time_local, "2026-10-12T07:10:00+09:00");
  assert.equal(offer.itinerary.return_departure_time_local, "2026-10-16T12:50:00+09:00");
  assert.equal(offer.itinerary.arrival_time_local, "2026-10-12T01:15:00.000Z", "07:10+09:00 + 185분");
  assert.equal(offer.itinerary.return_arrival_time_local, "2026-10-16T07:10:00.000Z", "12:50+09:00 + 200분");
});

// RECO-20260828-004: 쿼리 상대 월 토큰과 calendar(dict 키=날짜) 매핑 계약.
test("query month tokens resolve to YYYY-MM at fetch time", async () => {
  const { monthOffsetIso, resolveQueryMonthTokens } = await import("../scripts/run-authorized-feed-collector.mjs");
  const now = new Date("2026-08-28T01:00:00Z");
  assert.equal(monthOffsetIso(now, 0), "2026-08");
  assert.equal(monthOffsetIso(now, 1), "2026-09");
  assert.equal(monthOffsetIso(now, -1), "2026-07");
  assert.equal(monthOffsetIso(new Date("2026-12-15T00:00:00Z"), 1), "2027-01");
  assert.deepEqual(
    resolveQueryMonthTokens({ origin: "ICN", depart_date: "{month}:{month+2}", currency: "krw" }, now),
    { origin: "ICN", depart_date: "2026-08:2026-10", currency: "krw" },
  );
});

test("calendar-shaped date-keyed payload maps through single-level flatten", () => {
  const config = {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: "travelpayouts_aviasales_test",
    source_type: "meta_search",
    endpoint: "https://api.example.test/calendar",
    auth: { header_name: "X-Access-Token", token_env: "TEST_TOKEN" },
    query: { origin: "ICN", destination: "TYO", currency: "krw" },
    response_mapping: {
      adapter: "json_path_mapping",
      offers_path: "data",
      flatten_nested: { key_fields: ["depart_date"] },
      places_lookup: {
        key_field: "destination",
        drop_unmatched: true,
        entries: {
          TYO: { display_name_ko: "도쿄", display_name_en: "Tokyo", country_code: "JP", region: "JAPAN", latitude: 35.6762, longitude: 139.6503 },
        },
      },
      templates: {
        id: "tpcal_{destination}_{depart_date}_{return_at|date}",
        return_date: "{return_at|date}",
        deep_link: "https://www.aviasales.com/search/{origin}{destination}{depart_date|dmy}{return_at|dmy}1?marker=TEST",
        arrival_time_local: "{departure_at|plus_minutes:duration_to}",
        return_arrival_time_local: "{return_at|plus_minutes:duration_back}",
      },
      stay_nights_filter: { depart_field: "departure_at", return_field: "return_at", min: 3, max: 14 },
      defaults: { booking_source: "travelpayouts_aviasales" },
      fields: {
        origin_airport: "origin",
        destination_airport: "destination",
        destination_city_id: "destination",
        destination_display_name: "display_name_ko",
        country_code: "country_code",
        region: "region",
        depart_date: "depart_date",
        airline_code: "airline",
        airline_name: "airline",
        total_price: "price",
        stop_count: "transfers",
        departure_time_local: "departure_at",
        return_departure_time_local: "return_at",
      },
    },
  };
  const payload = {
    data: {
      "2026-09-16": { origin: "SEL", destination: "TYO", airline: "7C", departure_at: "2026-09-16T07:10:00+09:00", return_at: "2026-09-20T12:50:00+09:00", price: 363285, transfers: 1 },
      "2026-09-17": { origin: "SEL", destination: "PAR", airline: "KE", departure_at: "2026-09-17T07:10:00+09:00", return_at: "2026-09-18T12:50:00+09:00", price: 900000, transfers: 0 },
    },
  };

  const result = mapJsonPathFeedPayload(payload, config, { now: new Date("2026-08-28T00:00:00Z") });

  assert.equal(result.offers.length, 1, "미등록 목적지(PAR)·1박(규칙 밖) 행은 버려야 한다");
  const offer = result.offers[0];
  assert.equal(offer.origin.airport, "SEL");
  assert.equal(offer.destination.city_id, "TYO");
  assert.equal(offer.destination.display_name_ko, "도쿄");
  assert.equal(offer.dates.depart, "2026-09-16");
  assert.equal(offer.dates.return, "2026-09-20");
  assert.equal(offer.id, "tpcal_TYO_2026-09-16_2026-09-20");
  assert.equal(offer.source.deep_link, "https://www.aviasales.com/search/SELTYO160920091?marker=TEST");
  assert.equal(offer.itinerary.stops, 1);
  assert.equal(offer.price.total, 363285);
  // DATA-20260831-001 관성: 소요분(duration_to/back)이 없는 calendar 응답은 도착 시각을
  // 생략한다(plus_minutes가 빈 값 → 필드 미매핑) — 있는 출발 시각만 정직하게 채운다.
  assert.equal(offer.itinerary.departure_time_local, "2026-09-16T07:10:00+09:00");
  assert.equal(offer.itinerary.return_departure_time_local, "2026-09-20T12:50:00+09:00");
  assert.equal(offer.itinerary.arrival_time_local, undefined);
  assert.equal(offer.itinerary.return_arrival_time_local, undefined);
});

// RECO-20260828-004: allow_empty — 목적지별 calendar처럼 정상적으로 빈 수가 있는 소스는
// 실패가 아니라 빈 결과(skip)로 내려온다. 설정 버그 방지 기본값(엄격)은 유지된다.
test("allow_empty mapping returns empty offers instead of throwing", async () => {
  const { normalizeAuthorizedFeedPayload } = await import("../scripts/run-authorized-feed-collector.mjs");
  const config = {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: "travelpayouts_aviasales_test",
    source_type: "meta_search",
    endpoint: "https://api.example.test/calendar",
    auth: { header_name: "X-Access-Token", token_env: "TEST_TOKEN" },
    query: { origin: "ICN", destination: "LHR", currency: "krw" },
    response_mapping: {
      adapter: "json_path_mapping",
      offers_path: "data",
      flatten_nested: { key_fields: ["depart_date"] },
      allow_empty: true,
      places_lookup: { key_field: "destination", drop_unmatched: true, entries: { LHR: { display_name_ko: "런던", country_code: "GB", region: "EUROPE" } } },
      templates: { id: "tpcal_{destination}_{depart_date}", return_date: "{return_at|date}" },
      stay_nights_filter: { depart_field: "departure_at", return_field: "return_at", min: 3, max: 14 },
      defaults: { booking_source: "travelpayouts_aviasales" },
      fields: {
        origin_airport: "origin",
        destination_airport: "destination",
        destination_city_id: "destination",
        destination_display_name: "display_name_ko",
        country_code: "country_code",
        region: "region",
        depart_date: "depart_date",
        airline_code: "airline",
        airline_name: "airline",
        total_price: "price",
      },
    },
  };
  const payload = { data: {} };
  const mapped = mapJsonPathFeedPayload(payload, config, { now: new Date("2026-08-28T00:00:00Z") });
  assert.deepEqual(mapped.offers, []);
  assert.equal(normalizeAuthorizedFeedPayload(payload, config), null, "allow_empty + 빈 결과는 null(→ skipped)");
});
