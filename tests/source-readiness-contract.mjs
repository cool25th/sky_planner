import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceReadinessSnapshot } from "../lib/source-readiness.ts";

const NOW = new Date("2026-05-25T04:30:00Z");

function healthyRows() {
  return [
    {
      source_id: "skyscanner_affiliate",
      is_paused: false,
      enabled_by_flag: true,
      circuit_breaker_open: false,
      consecutive_failures: 0,
      last_success_at: "2026-05-25T04:00:00Z",
      last_checked_at: "2026-05-25T04:00:00Z",
      stats_24h: { total_jobs: 1, success_count: 1 },
    },
    {
      source_id: "korean_air_official",
      is_paused: false,
      enabled_by_flag: true,
      circuit_breaker_open: false,
      consecutive_failures: 0,
      last_success_at: "2026-05-25T03:55:00Z",
    },
    {
      source_id: "asiana_official",
      is_paused: false,
      enabled_by_flag: true,
      circuit_breaker_open: false,
      consecutive_failures: 0,
      last_success_at: "2026-05-25T03:50:00Z",
    },
  ];
}

test("source readiness is ready when the minimum enabled sources are healthy and last batch succeeded", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    latestJobs: [
      {
        source_id: "skyscanner_affiliate",
        execution_id: "job_1",
        status: "success",
        offers_found: 10,
        created_at: "2026-05-25T04:00:00Z",
      },
    ],
    batchState: { status: "success", execution_id: "batch_1" },
    now: NOW,
    env: {},
  });

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.source_flags, [
    "skyscanner_affiliate",
    "korean_air_official",
    "asiana_official",
  ]);
  assert.equal(snapshot.counts.search_eligible_sources, 3);
  assert.equal(snapshot.counts.minimum_search_eligible_sources, 1);
  assert.deepEqual(snapshot.readiness_blockers, []);
  assert.equal(snapshot.sources.find((source) => source.source_id === "skyscanner_affiliate").latest_job.execution_id, "job_1");
});

test("source readiness reports stale, paused, and circuit-open enabled sources", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: [
      {
        source_id: "skyscanner_affiliate",
        last_success_at: "2026-05-23T04:00:00Z",
      },
      {
        source_id: "korean_air_official",
        is_paused: true,
        last_success_at: "2026-05-25T03:55:00Z",
      },
      {
        source_id: "asiana_official",
        circuit_breaker_open: true,
        consecutive_failures: 3,
        last_success_at: "2026-05-25T03:50:00Z",
      },
    ],
    batchState: { status: "success" },
    now: NOW,
    env: { SOURCE_MAX_STALE_HOURS: "24", SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false" },
  });

  assert.equal(snapshot.status, "not_ready");
  assert.deepEqual(snapshot.source_flags, []);
  assert.deepEqual(snapshot.blocked_source_ids, [
    "skyscanner_affiliate",
    "korean_air_official",
    "asiana_official",
  ]);
  assert.equal(snapshot.sources.find((source) => source.source_id === "skyscanner_affiliate").block_reason, "stale");
  assert.equal(snapshot.sources.find((source) => source.source_id === "korean_air_official").block_reason, "paused");
  assert.equal(snapshot.sources.find((source) => source.source_id === "asiana_official").block_reason, "circuit_breaker_open");
});

// DATA-20260829-001 ②: TP 단일 실소스 체제 — eligible 1소스로도 ready, 0소스는 미달.
test("source readiness stays ready with a single eligible source", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    batchState: { status: "success" },
    now: NOW,
    env: {
      SOURCE_SKYSCANNER_ENABLED: "false",
      SOURCE_KOREAN_AIR_ENABLED: "false",
      SOURCE_ASIANA_ENABLED: "true",
    },
  });

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.source_flags, ["asiana_official"]);
  assert.equal(snapshot.counts.search_eligible_sources, 1);
  assert.equal(snapshot.counts.minimum_search_eligible_sources, 1);
  assert.deepEqual(snapshot.readiness_blockers, []);
});

test("source readiness blocks launch when every enabled source is env-disabled", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    batchState: { status: "success" },
    now: NOW,
    env: {
      SOURCE_SKYSCANNER_ENABLED: "false",
      SOURCE_KOREAN_AIR_ENABLED: "false",
      SOURCE_ASIANA_ENABLED: "false",
    },
  });

  assert.equal(snapshot.status, "not_ready");
  assert.deepEqual(snapshot.source_flags, []);
  assert.deepEqual(snapshot.readiness_blockers, ["insufficient_search_eligible_sources"]);
  assert.equal(snapshot.sources.find((source) => source.source_id === "skyscanner_affiliate").block_reason, "disabled_by_env");
});

test("source readiness stays ready when two enabled sources remain healthy", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    batchState: { status: "success" },
    now: NOW,
    env: {
      SOURCE_SKYSCANNER_ENABLED: "false",
      SOURCE_KOREAN_AIR_ENABLED: "true",
      SOURCE_ASIANA_ENABLED: "true",
    },
  });

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.source_flags, [
    "korean_air_official",
    "asiana_official",
  ]);
  assert.deepEqual(snapshot.readiness_blockers, []);
});

test("source readiness blocks service mode when source env config is implicit or invalid", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    batchState: { status: "success" },
    now: NOW,
    env: {
      SERVICE_REQUIRE_POSTGRES: "true",
      SOURCE_SKYSCANNER_ENABLED: "true",
      SOURCE_KOREAN_AIR_ENABLED: "maybe",
      SOURCE_ASIANA_ENABLED: "true",
      SOURCE_GOOGLE_FLIGHTS_ENABLED: "false",
      SOURCE_KAYAK_ENABLED: "false",
      SOURCE_PROMO_PAGES_ENABLED: "",
      SOURCE_TRAVELPAYOUTS_AVIASALES_ENABLED: "false",
      SOURCE_MAX_STALE_HOURS: "zero",
    },
  });

  assert.equal(snapshot.status, "not_ready");
  assert.deepEqual(snapshot.source_flags, []);
  assert.deepEqual(snapshot.readiness_blockers, [
    "source_kill_switches_invalid",
    "source_max_stale_hours_invalid",
    "insufficient_search_eligible_sources",
  ]);
  assert.deepEqual(snapshot.env_config.invalid_source_flags, [
    { source_id: "korean_air_official", env_name: "SOURCE_KOREAN_AIR_ENABLED", reason: "invalid_boolean" },
    { source_id: "official_promo_pages", env_name: "SOURCE_PROMO_PAGES_ENABLED", reason: "missing" },
  ]);
  assert.deepEqual(snapshot.env_config.source_max_stale_hours_issue, {
    env_name: "SOURCE_MAX_STALE_HOURS",
    reason: "invalid_positive_integer",
  });
});

test("source readiness is not ready when last batch did not succeed", () => {
  const snapshot = buildSourceReadinessSnapshot({
    healthRows: healthyRows(),
    batchState: { status: "failed" },
    now: NOW,
    env: {},
  });

  assert.equal(snapshot.status, "not_ready");
  assert.equal(snapshot.counts.search_eligible_sources, 3);
  assert.deepEqual(snapshot.readiness_blockers, ["last_batch_failed"]);
});
