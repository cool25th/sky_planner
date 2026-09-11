import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSnapshotRows,
  collectorDatabaseUrl,
  deactivateDealsWithoutLiveOffers,
  parseCollectorBatch,
  partitionOfferRows,
  sourceHealthStats24h,
  sourceJobExpireAt,
  summarizeCollectorBatch,
  touchUnchangedOffers,
  upsertSourceAudit,
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

// INT-20260909-001: stats_24h는 source_jobs의 실제 24시간 창 집계다 — TP 전환 후 30개 설정이
// 하나의 source_id를 공유하며 마지막 잡의 단일 값(total_jobs:1)로 덮어쓰던 결함(2026-09-09 실측:
// 28잡 성공 배치에 total_jobs=1, 창 내 실패가 뒤늦은 성공에 덮여 숨음)의 재발 방지 계약.
test("sourceHealthStats24h aggregates the real 24h window from source_jobs", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return {
        rows: [{
          total_jobs: 28,
          success_count: 26,
          failure_count: 2,
          block_count: 1,
          schema_validation_failure_count: 0,
          price_anomaly_count: 3,
          avg_latency_ms: 139,
          write_amplification_ratio: "0.5909",
        }],
      };
    },
  };

  const stats = await sourceHealthStats24h(client, "travelpayouts_aviasales", "2026-09-08T18:57:00Z");
  assert.match(queries[0].sql, /FROM source_jobs/i);
  assert.match(queries[0].sql, /created_at > \$2/);
  assert.equal(queries[0].params[0], "travelpayouts_aviasales");
  assert.equal(queries[0].params[1], "2026-09-07T18:57:00.000Z", "창 하한은 기준시각-24h");
  assert.equal(stats.total_jobs, 28);
  assert.equal(stats.failure_count, 2, "창 내 실패가 집계에 남는다 — 뒤늦은 성공이 덮지 않는다");
  assert.equal(stats.write_amplification_ratio, 0.5909);
});

test("upsertSourceAudit writes the job row before aggregating window stats", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM source_jobs/i.test(sql)) {
        return {
          rows: [{
            total_jobs: 28,
            success_count: 28,
            failure_count: 0,
            block_count: 0,
            schema_validation_failure_count: 0,
            price_anomaly_count: 0,
            avg_latency_ms: 139,
            write_amplification_ratio: "0.5909",
          }],
        };
      }
      return { rows: [] };
    },
  };
  const batch = {
    execution_id: "exec1",
    source_id: "travelpayouts_aviasales",
    parser_version: "authorized-json-feed-v1",
    collected_at: "2026-09-08T18:57:00Z",
    artifact_prefix: "runtime/collector-artifacts/x",
    stats: {},
  };

  await upsertSourceAudit(client, batch, [{ offer_id: "a" }], [{ offer_id: "a" }, { offer_id: "b" }]);

  const jobsIndex = queries.findIndex((q) => /INSERT INTO source_jobs/i.test(q.sql));
  const aggIndex = queries.findIndex((q) => /FROM source_jobs/i.test(q.sql));
  const healthIndex = queries.findIndex((q) => /INSERT INTO source_health/i.test(q.sql));
  assert.ok(jobsIndex !== -1 && aggIndex !== -1 && healthIndex !== -1);
  assert.ok(jobsIndex < aggIndex, "현재 잡을 창에 포함시키려면 잡 삽입이 집계보다 먼저다");
  assert.ok(aggIndex < healthIndex, "health upsert는 집계 결과를 싣는다");
  const stats = JSON.parse(queries[healthIndex].params[1]);
  assert.equal(stats.total_jobs, 28, "health의 stats_24h는 창 집계값 — 마지막 잡 단일 값(total_jobs:1)이 아니다");
  assert.equal(stats.success_count, 28);
});

test("deactivateDealsWithoutLiveOffers flips only active groups with no live offers", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ deal_id: "a" }, { deal_id: "b" }] };
    },
  };

  const deactivated = await deactivateDealsWithoutLiveOffers(client);

  assert.equal(deactivated, 2, "RETURNING 행 수가 비활성 전환 그룹 수다");
  const sql = queries[0].sql;
  assert.match(sql, /UPDATE deals_current d SET is_active = false/i);
  assert.match(sql, /WHERE d\.is_active = true/i);
  assert.match(sql, /NOT EXISTS/i, "live 조인 부재 조건 — live 있는 그룹은 건드리지 않는다");
  assert.match(sql, /l\.origin_airport = d\.origin/i);
  assert.match(sql, /l\.destination_city_id = d\.destination_city_id/i);
  assert.match(sql, /l\.week = d\.week/i);
  assert.match(sql, /l\.stay_bucket = d\.stay_bucket/i);
  assert.match(sql, /l\.traveler = d\.traveler/i);
  assert.doesNotMatch(sql, /DELETE/i, "비활성 전환만 — 데이터 삭제가 아니라");
});

test("ingest deactivates no-live deals before measuring the join ratio", async () => {
  const source = readFileSync("scripts/ingest-collector-batch.mjs", "utf8");
  const upsertIndex = source.indexOf("await upsertDeals(client, dealRows)");
  const deactivateIndex = source.indexOf("await deactivateDealsWithoutLiveOffers(client)");
  const measureIndex = source.indexOf("const dealJoin = await measureDealOfferJoin(client)");
  assert.ok(upsertIndex !== -1 && deactivateIndex !== -1 && measureIndex !== -1);
  assert.ok(
    upsertIndex < deactivateIndex && deactivateIndex < measureIndex,
    "딜 적재 → 비활성 전환 → ratio 측정 순서 — 측정은 정리된 상태를 본다(매 배치 ~1.0 수렴)",
  );
  assert.ok(
    source.indexOf("await client.query(\"BEGIN\")") < deactivateIndex
      && deactivateIndex < source.indexOf('options.rollback ? "ROLLBACK" : "COMMIT"'),
    "비활성 전환은 트랜잭션 안에서 실행된다",
  );
});

test("source job inserts stamp expire_at at completion + 30 days on every write path", async () => {
  // INT-20260904-001: require/database.md 보존 계약(30일). 컬럼은 이미 DDL·프로덕션에 존재 —
  // 성공(ingest)·실패(collector)·시드(seed) 3개 삽입 경로가 전부 스탬프하는지 고정한다.
  assert.equal(
    sourceJobExpireAt("2026-09-10T03:49:52Z"),
    "2026-10-10T03:49:52.000Z",
    "만료시각 = 완료시각 + 30일",
  );
  assert.equal(sourceJobExpireAt("not-a-date"), null);

  const ingestSource = readFileSync("scripts/ingest-collector-batch.mjs", "utf8");
  const ingestInsert = ingestSource.match(/INSERT INTO source_jobs \([\s\S]*?\);/)[0];
  assert.match(ingestInsert, /expire_at/);
  assert.match(ingestSource, /sourceJobExpireAt\(utcTimestamp\(batch\.stats\.completed_at \?\? batch\.collected_at\)\)/);

  const collectorSource = readFileSync("scripts/run-authorized-feed-collector.mjs", "utf8");
  const collectorInsert = collectorSource.match(/INSERT INTO source_jobs \([\s\S]*?\);/)[0];
  assert.match(collectorInsert, /expire_at/);
  assert.match(collectorSource, /sourceJobExpireAt\(completedAt\)/);

  const seedSource = readFileSync("scripts/seed-postgres.mjs", "utf8");
  const seedInsert = seedSource.match(/INSERT INTO source_jobs \([\s\S]*?\);/)[0];
  assert.match(seedInsert, /expire_at/);
  // seed는 SQL 리터럴로 산출 — 상수 짝 계약(한쪽만 바꾸면 실패, fare-freshness 이중 상수 패턴).
  assert.match(seedInsert, /NOW\(\) \+ make_interval\(days => 30\)/);
  assert.match(ingestSource, /SOURCE_JOB_RETENTION_DAYS = 30/);
});

test("currentOfferHashes reads only the incoming offers' fingerprints (Neon egress fix 2026-09-11)", async () => {
  // 이전 구현은 소스마다 batch_state.offer_hashes 매니페스트를 통째로 SELECT해
  // 28소스 × 수 MB × 매 배치로 무료 5GB/월 이그레스를 소진했다. 이제 수신 행의
  // offer_id만 PK 조회한다 — 전체 매니페스트 인출과 batch_state 읽기는 금지(소스 스캔).
  const { currentOfferHashes } = await import("../scripts/ingest-collector-batch.mjs");
  const queries = [];
  const client = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [
    { offer_id: "collector-aaa", write_fingerprint: "fp-1" },
  ] } } };
  const manifest = await currentOfferHashes(client, [
    { offer_id: "collector-aaa", write_fingerprint: "fp-1" },
    { offer_id: "collector-bbb", write_fingerprint: "fp-2" },
  ]);
  assert.deepEqual(manifest, { "collector-aaa": "fp-1" });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM offers/);
  assert.match(queries[0].sql, /offer_id = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(queries[0].params[0], ["collector-aaa", "collector-bbb"]);

  const empty = await currentOfferHashes(client, []);
  assert.deepEqual(empty, {}, "빈 배치는 쿼리 없이 빈 매니페스트");
  assert.equal(queries.length, 1, "빈 배치는 추가 쿼리를 실행하지 않는다");

  const script = readFileSync(join(repoRoot, "scripts/ingest-collector-batch.mjs"), "utf8");
  assert.doesNotMatch(script, /SELECT data FROM batch_state WHERE key = 'offer_hashes'/, "전체 매니페스트 인출 회귀 금지");
});
