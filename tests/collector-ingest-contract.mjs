import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectorDatabaseUrl,
  parseCollectorBatch,
  partitionOfferRows,
  summarizeCollectorBatch,
  touchUnchangedOffers,
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

// DATA-20260901-001: 지문 미변경 오퍼는 upsert에서 제외되므로 last_seen_at을 별도 갱신한다 —
// 이 갱신이 없으면 last_seen_at이 '마지막 변경 시각'이 되고 fare-freshness 72h 숨김이
// 매일 재수집되는 살아 있는 재고(실측: 활성 1,299건 중 795건, /offers 273조합 0건)를 지운다.
test("partitionOfferRows splits re-collected rows into changed and unchanged", () => {
  const rows = [
    { offer_id: "a", write_fingerprint: "f1" },
    { offer_id: "b", write_fingerprint: "f2" },
    { offer_id: "c", write_fingerprint: "f3" },
  ];
  const { changedRows, unchangedRows } = partitionOfferRows(rows, { a: "f1", b: "other" });
  assert.deepEqual(changedRows.map((r) => r.offer_id), ["b", "c"]); // 신규(c)·변경(b)은 upsert
  assert.deepEqual(unchangedRows.map((r) => r.offer_id), ["a"]); // 동일 지문은 touch 대상
});

test("touchUnchangedOffers bumps last_seen_at for unchanged rows only, skipping when empty", async () => {
  const queries = [];
  const client = { query: async (sql, params) => { queries.push({ sql, params }); } };
  const batch = { collected_at: "2026-09-01T02:00:00Z" };
  const rows = [
    { offer_id: "a", write_fingerprint: "f1" },
    { offer_id: "b", write_fingerprint: "f2" },
  ];

  const touched = await touchUnchangedOffers(client, rows, batch);
  assert.equal(touched, 2);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE offers SET last_seen_at = \$1, last_batch_at = \$1/i);
  assert.equal(queries[0].params[0], "2026-09-01T02:00:00Z");
  assert.deepEqual(queries[0].params[1], ["a", "b"]);

  queries.length = 0;
  assert.equal(await touchUnchangedOffers(client, [], batch), 0);
  assert.equal(queries.length, 0); // 빈 배치·전량 변경 시 UPDATE 자체를 낭비하지 않는다
});
