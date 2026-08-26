import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectorDatabaseUrl,
  parseCollectorBatch,
  summarizeCollectorBatch,
} from "../scripts/ingest-collector-batch.mjs";

const fixturePath = new URL("./fixtures/collector-batch.sample.json", import.meta.url);

test("collector normalized batch fixture validates and summarizes write scope", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf-8"));
  const batch = parseCollectorBatch(payload);
  const summary = summarizeCollectorBatch(batch);

  assert.equal(batch.schema_version, "collector.normalized_batch.v1");
  assert.equal(batch.source_id, "korean_air_official");
  assert.equal(summary.offers_received, 2);
  assert.equal(summary.anomaly_offers, 1);
  assert.equal(summary.materializable_groups, 1);
});

test("collector validation rejects empty batches before DB writes", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf-8"));
  payload.offers = [];

  assert.throws(() => parseCollectorBatch(payload), /offers/);
});

test("collector validation rejects non-positive fare totals before DB writes", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf-8"));
  payload.offers[0].total_price = 0;

  assert.throws(() => parseCollectorBatch(payload), /total_price/);
});

test("collector validation rejects unsupported cabin values", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf-8"));
  payload.offers[0].cabin_group = "premium_business";

  assert.throws(() => parseCollectorBatch(payload), /cabin_group/);
});

test("collector DB writes require DATABASE_URL in postgres-only service mode", () => {
  assert.throws(
    () => collectorDatabaseUrl({ env: { SERVICE_REQUIRE_POSTGRES: "true" } }),
    /DATABASE_URL is required/,
  );
  assert.equal(
    collectorDatabaseUrl({
      env: {
        SERVICE_REQUIRE_POSTGRES: "true",
        DATABASE_URL: "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
      },
    }),
    "postgresql://sky_planner:secret@db.skyplanner.co.kr:5432/sky_planner",
  );
  assert.match(collectorDatabaseUrl({ env: {} }), /localhost:5433\/sky_planner/);
});
