import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSnapshotRows,
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

// DATA-20260904-001: require/database.md 보존 계약 — fare_snapshots는 수집시각+90일 expire_at을 달고
// 적재된다. expire_at이 null이면 만료 인덱스(idx_snapshots_expire)가 무의미해지고 감사 이력이
// 무한 적재된다(Neon 무료 저장 한도 0.5GB). 정리 DELETE 소비자는 별도 승인 작업.
test("buildSnapshotRows stamps expire_at at collected_at + 90 days", () => {
  const base = {
    offer_id: "o1",
    execution_id: "exec1",
    source_job_id: "job1",
    origin_airport: "ICN",
    destination_city_id: "fuk",
    depart_date: "2026-09-07",
    return_date: "2026-09-10",
    stay_bucket: "3_4",
    traveler: "adt1",
    airline_code: "LJ",
    cabin_group: "economy",
    tax_included: true,
    total_price: 123205,
    currency: "KRW",
    normalized_total_krw: 123205,
    write_fingerprint: "f1",
    booking_source: "travelpayouts_aviasales",
    parser_version: "tp-1",
    capture_channel: "api",
    raw_payload_ref: null,
    price_anomaly_status: "normal",
  };
  const rows = buildSnapshotRows([
    { ...base, captured_at: "2026-09-04T03:53:00Z" },
    { ...base, captured_at: "2026-09-04T03:53:00+09:00" },
    { ...base, captured_at: undefined },
  ]);
  assert.equal(rows[0].expire_at, "2026-12-03T03:53:00.000Z", "Z 시각은 +90일 만료");
  assert.equal(rows[1].expire_at, "2026-12-02T18:53:00.000Z", "오프셋 시각은 절대시각 기준 +90일");
  assert.equal(rows[1].collected_at, "2026-09-04T03:53:00+09:00", "collected_at은 원본 표기 유지");
  assert.equal(rows[2].expire_at, null, "결측 captured_at은 추정 만료를 만들지 않고 null 유지");
});
