import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCollectorSourceManifest,
  loadCollectorSourceManifestFromEnv,
  runCollectorSources,
} from "../scripts/run-collector-sources.mjs";

const fixturePath = new URL("./fixtures/authorized-feed-response.sample.json", import.meta.url);
const mappedFixturePath = new URL("./fixtures/mapped-partner-feed.sample.json", import.meta.url);
process.env.COLLECTOR_SOURCE_TEST_TOKEN = "collector-source-test-token";

async function withMixedSourceServer(handler) {
  const fixture = await readFile(fixturePath, "utf-8");
  const mappedFixture = await readFile(mappedFixturePath, "utf-8");
  let lastRevalidateRequest = null;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/success")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture);
      return;
    }
    if (req.url?.startsWith("/mapped")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(mappedFixture);
      return;
    }
    if (req.url?.startsWith("/fail")) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "maintenance" }));
      return;
    }
    if (req.url?.startsWith("/revalidate-fail")) {
      lastRevalidateRequest = req;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "cache_backend_unavailable" }));
      return;
    }
    if (req.url?.startsWith("/revalidate")) {
      lastRevalidateRequest = req;
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.searchParams.has("secret") || req.headers["x-revalidate-secret"] !== "test-secret") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, revalidated: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    return await handler({
      baseUrl: `http://127.0.0.1:${port}`,
      lastRevalidateRequest: () => lastRevalidateRequest,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function sourceConfig(sourceId, endpoint) {
  return {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: sourceId,
    source_type: "meta_search",
    parser_version: "authorized-json-feed-test-v1",
    endpoint,
    method: "GET",
    auth: {
      header_name: "x-api-key",
      token_env: "COLLECTOR_SOURCE_TEST_TOKEN",
    },
    query: {
      origin: "ICN",
      destination: "TYO",
    },
  };
}

function mappedSourceConfig(sourceId, endpoint) {
  return {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: sourceId,
    source_type: "meta_search",
    parser_version: "json-path-mapping-test-v1",
    endpoint,
    method: "GET",
    auth: {
      header_name: "x-api-key",
      token_env: "COLLECTOR_SOURCE_TEST_TOKEN",
    },
    response_mapping: {
      adapter: "json_path_mapping",
      collected_at_path: "meta.collectedAt",
      offers_path: "data.quotes",
      defaults: {
        traveler: "adt1",
        currency: "KRW",
        tax_included: true,
        country_code: "JP",
        region: "JAPAN",
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
        depart_date: "depart",
        return_date: "return",
        airline_code: "airline.code",
        airline_name: "airline.name",
        booking_source: "bookingSource",
        source_type: "sourceType",
        deep_link: "bookingUrl",
        cabin_group: "cabin",
        total_price: "totalKrw",
        stop_count: "stops",
      },
    },
  };
}

test("collector source manifest runner keeps successful sources when one source fails", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-sources-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config: sourceConfig("partner_success", `${baseUrl}/success`) },
          { config: sourceConfig("partner_failure", `${baseUrl}/fail`) },
          { enabled: false, config: sourceConfig("partner_disabled", `${baseUrl}/success`) },
        ],
      }, {
        runId: "collector_manifest_test",
      });

      assert.equal(summary.status, "completed_with_failures");
      assert.equal(summary.sources_total, 3);
      assert.equal(summary.succeeded, 1);
      assert.equal(summary.failed, 1);
      assert.equal(summary.skipped, 1);
      assert.equal(summary.results[0].source_id, "partner_success");
      assert.equal(summary.results[0].status, "validated");
      assert.equal(summary.results[0].offers_received, 2);
      assert.equal(summary.results[1].source_id, "partner_failure");
      assert.equal(summary.results[1].failure_code, "source_unavailable");
      assert.equal(summary.results[2].status, "skipped");

      const normalizedPath = path.join(tmpDir, "collector_manifest_test", "partner_success", "normalized-batch.json");
      const normalized = JSON.parse(await readFile(normalizedPath, "utf-8"));
      assert.equal(normalized.execution_id, "collector_manifest_test_partner_success");
      assert.equal(normalized.offers.length, 2);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner rejects non-promo inline configs without auth", async () => {
  await assert.rejects(() => runCollectorSources({
    schema_version: "collector.source_manifest.v1",
    sources: [
      {
        config: {
          ...sourceConfig("partner_without_auth", "https://feeds.example-prod.com/fares"),
          auth: undefined,
        },
      },
    ],
  }), /non-promo source requires auth\.token_env/);
});

test("collector source manifest runner allows promo page inline configs without auth", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-promo-source-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      const config = {
        ...mappedSourceConfig("promo_page_source", `${baseUrl}/mapped`),
        source_type: "promo_page",
      };
      delete config.auth;
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [{ config }],
      }, {
        runId: "collector_promo_page_manifest_test",
      });

      assert.equal(summary.status, "success");
      assert.equal(summary.succeeded, 1);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner records aggregate last batch state after ingest", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-sources-batch-state-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      let recordedLastBatch = null;
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config: sourceConfig("partner_success", `${baseUrl}/success`) },
          { config: sourceConfig("partner_failure", `${baseUrl}/fail`) },
        ],
      }, {
        runId: "collector_batch_state_test",
        ingest: true,
        ingestBatch: async (batch) => ({
          status: "committed",
          execution_id: batch.execution_id,
          source_id: batch.source_id,
          offers_received: batch.offers.length,
        }),
        recordRunBatchState: async (lastBatch) => {
          recordedLastBatch = lastBatch;
          return { status: "recorded", key: "last_batch" };
        },
      });

      assert.equal(summary.status, "completed_with_failures");
      assert.deepEqual(recordedLastBatch.source_flags, ["partner_success"]);
      assert.deepEqual(recordedLastBatch.manifest_source_ids, ["partner_failure", "partner_success"]);
      assert.deepEqual(recordedLastBatch.failed_source_ids, ["partner_failure"]);
      assert.equal(recordedLastBatch.status, "completed_with_failures");
      assert.equal(summary.batch_state.status, "recorded");
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner skips aggregate last batch write on rollback", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-sources-rollback-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      let wroteBatchState = false;
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config: sourceConfig("partner_success", `${baseUrl}/success`) },
        ],
      }, {
        runId: "collector_rollback_batch_state_test",
        ingest: true,
        rollback: true,
        ingestBatch: async (batch) => ({
          status: "rolled_back",
          execution_id: batch.execution_id,
          source_id: batch.source_id,
          offers_received: batch.offers.length,
        }),
        recordRunBatchState: async () => {
          wroteBatchState = true;
          return { status: "recorded" };
        },
      });

      assert.equal(summary.status, "success");
      assert.equal(summary.batch_state, null);
      assert.equal(summary.batch_state_skipped_reason, "rollback");
      assert.equal(wroteBatchState, false);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner keeps previous batch state when all sources fail", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-sources-empty-run-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      let wroteBatchState = false;
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config: sourceConfig("partner_failure_a", `${baseUrl}/fail`) },
          { config: sourceConfig("partner_failure_b", `${baseUrl}/fail`) },
        ],
      }, {
        runId: "collector_empty_run_batch_state_test",
        ingest: true,
        ingestBatch: async () => {
          throw new Error("should not ingest a failed source");
        },
        recordRunBatchState: async () => {
          wroteBatchState = true;
          return { status: "recorded" };
        },
      });

      assert.equal(summary.status, "failed");
      assert.equal(summary.succeeded, 0);
      assert.equal(summary.failed, 2);
      assert.equal(summary.batch_state, null);
      assert.equal(summary.batch_state_skipped_reason, "no_successful_sources");
      assert.equal(wroteBatchState, false);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest loader resolves relative config paths", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-manifest-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      await writeFile(
        path.join(tmpDir, "source.json"),
        `${JSON.stringify(sourceConfig("partner_from_file", `${baseUrl}/success`), null, 2)}\n`,
      );
      const manifestPath = path.join(tmpDir, "manifest.json");
      await writeFile(manifestPath, `${JSON.stringify({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config_path: "source.json" },
        ],
      }, null, 2)}\n`);

      const manifest = await loadCollectorSourceManifest(manifestPath);
      assert.equal(manifest.sources[0].config.source_id, "partner_from_file");

      const summary = await runCollectorSources(manifest, { runId: "collector_manifest_file_test" });
      assert.equal(summary.status, "success");
      assert.equal(summary.succeeded, 1);
      assert.equal(summary.results[0].source_id, "partner_from_file");
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner records config path source ids in aggregate batch state", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-manifest-path-batch-state-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      await writeFile(
        path.join(tmpDir, "source.json"),
        `${JSON.stringify(sourceConfig("partner_from_file", `${baseUrl}/success`), null, 2)}\n`,
      );
      let recordedLastBatch = null;
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config_path: path.join(tmpDir, "source.json") },
        ],
      }, {
        runId: "collector_manifest_path_batch_state_test",
        ingest: true,
        ingestBatch: async (batch) => ({
          status: "committed",
          execution_id: batch.execution_id,
          source_id: batch.source_id,
          offers_received: batch.offers.length,
        }),
        recordRunBatchState: async (lastBatch) => {
          recordedLastBatch = lastBatch;
          return { status: "recorded", key: "last_batch" };
        },
      });

      assert.equal(summary.status, "success");
      assert.deepEqual(recordedLastBatch.source_flags, ["partner_from_file"]);
      assert.deepEqual(recordedLastBatch.manifest_source_ids, ["partner_from_file"]);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest loader reads inline source configs from env", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-manifest-env-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      const env = {
        COLLECTOR_SOURCE_MANIFEST_TEST_JSON: JSON.stringify({
          schema_version: "collector.source_manifest.v1",
          artifact_root: tmpDir,
          sources: [
            { config: sourceConfig("partner_from_env", `${baseUrl}/success`) },
          ],
        }),
      };

      const manifest = await loadCollectorSourceManifestFromEnv("COLLECTOR_SOURCE_MANIFEST_TEST_JSON", { env });
      assert.equal(manifest.sources[0].config.source_id, "partner_from_env");

      const summary = await runCollectorSources(manifest, { runId: "collector_manifest_env_test" });
      assert.equal(summary.status, "success");
      assert.equal(summary.succeeded, 1);
      assert.equal(summary.results[0].source_id, "partner_from_env");
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest preserves json path mapping in inline configs", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-mapped-manifest-"));
  try {
    await withMixedSourceServer(async ({ baseUrl }) => {
      const summary = await runCollectorSources({
        schema_version: "collector.source_manifest.v1",
        artifact_root: tmpDir,
        sources: [
          { config: mappedSourceConfig("mapped_partner_from_manifest", `${baseUrl}/mapped`) },
        ],
      }, {
        runId: "collector_mapped_manifest_test",
      });

      assert.equal(summary.status, "success");
      assert.equal(summary.succeeded, 1);
      assert.equal(summary.results[0].source_id, "mapped_partner_from_manifest");
      assert.equal(summary.results[0].offers_received, 2);

      const normalizedPath = path.join(tmpDir, "collector_mapped_manifest_test", "mapped_partner_from_manifest", "normalized-batch.json");
      const normalized = JSON.parse(await readFile(normalizedPath, "utf-8"));
      assert.equal(normalized.offers[0].source_offer_id, "raw-partner-tyo-economy-001");
      assert.equal(normalized.offers[0].total_price, 312000);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner triggers revalidation after successful sources", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-revalidate-"));
  try {
  await withMixedSourceServer(async ({ baseUrl, lastRevalidateRequest }) => {
    const summary = await runCollectorSources({
      schema_version: "collector.source_manifest.v1",
      artifact_root: tmpDir,
      revalidate: {
        url: `${baseUrl}/revalidate`,
        secret: "test-secret",
      },
      sources: [
        { config: sourceConfig("partner_success", `${baseUrl}/success`) },
      ],
    }, {
      runId: "collector_revalidate_test",
    });

    assert.equal(summary.status, "success");
    assert.equal(summary.revalidation.status, "revalidated");
    assert.equal(summary.revalidation.http_status, 200);
    assert.equal(summary.revalidation.body.revalidated, true);
    assert.equal(lastRevalidateRequest().method, "POST");
    assert.equal(lastRevalidateRequest().headers["x-revalidate-secret"], "test-secret");
    assert.doesNotMatch(lastRevalidateRequest().url, /secret=/);
  });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner skips revalidation when any source fails", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-revalidate-partial-"));
  try {
  await withMixedSourceServer(async ({ baseUrl, lastRevalidateRequest }) => {
    const summary = await runCollectorSources({
      schema_version: "collector.source_manifest.v1",
      artifact_root: tmpDir,
      revalidate: {
        url: `${baseUrl}/revalidate`,
        secret: "test-secret",
      },
      sources: [
        { config: sourceConfig("partner_success", `${baseUrl}/success`) },
        { config: sourceConfig("partner_failure", `${baseUrl}/fail`) },
      ],
    }, {
      runId: "collector_revalidate_partial_test",
    });

    assert.equal(summary.status, "completed_with_failures");
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.revalidation.status, "skipped");
    assert.equal(summary.revalidation.reason, "source_failures_present");
    assert.equal(lastRevalidateRequest(), null);
  });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("collector source manifest runner reports revalidation failures", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-revalidate-fail-"));
  try {
  await withMixedSourceServer(async ({ baseUrl }) => {
    const summary = await runCollectorSources({
      schema_version: "collector.source_manifest.v1",
      artifact_root: tmpDir,
      revalidate: {
        url: `${baseUrl}/revalidate-fail`,
        secret: "test-secret",
      },
      sources: [
        { config: sourceConfig("partner_success", `${baseUrl}/success`) },
      ],
    }, {
      runId: "collector_revalidate_failure_test",
    });

    assert.equal(summary.status, "revalidation_failed");
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.revalidation.status, "failed");
    assert.match(summary.revalidation.error, /returned 500/);
  });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// D2(NEXT-TASKS Workstream D): shared response_mapping 계약 — ref 전개·명시 우선·알 수 없는 ref 즉시 실패.
// 매니페스트 secret 48KB 한도에서 소스별 mapping 반복(~1.6KB×N)을 없애는 메커니즘(PUS 캘린더 확장 전제).
async function writeTempManifest(manifest) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sky-planner-shared-mapping-"));
  const file = path.join(dir, "manifest.json");
  await writeFile(file, JSON.stringify(manifest));
  return { dir, file };
}

function refSourceConfig(sourceId, ref, overrides = {}) {
  return {
    schema_version: "collector.authorized_feed_source.v1",
    source_id: sourceId,
    source_type: "meta_search",
    endpoint: "https://api.travelpayouts.com/v1/prices/calendar",
    auth: { header_name: "X-Access-Token", token_env: "COLLECTOR_SOURCE_TEST_TOKEN" },
    query: { origin: "PUS", destination: "FUK", currency: "krw" },
    response_mapping_ref: ref,
    ...overrides,
  };
}

test("shared response mappings expand refs and inline mappings win", async () => {
  const calendarMapping = {
    adapter: "json_path_mapping",
    offers_path: "data",
    fields: { total_price: "price", depart_date: "depart_date" },
  };
  const { dir, file } = await writeTempManifest({
    schema_version: "collector.source_manifest.v1",
    shared: { response_mappings: { calendar: calendarMapping } },
    sources: [
      { config: refSourceConfig("pus_fuk_calendar", "calendar") },
      { config: refSourceConfig("pus_inline_override", "calendar", { response_mapping: { adapter: "json_path_mapping", offers_path: "inline" } }) },
    ],
  });
  try {
    const loaded = await loadCollectorSourceManifest(file);
    assert.deepEqual(loaded.sources[0].config.response_mapping, calendarMapping, "ref는 shared 실체로 전개");
    assert.equal(loaded.sources[0].config.response_mapping_ref, undefined, "전개 후 ref 키는 제거");
    assert.equal(loaded.sources[1].config.response_mapping.offers_path, "inline", "명시 mapping이 ref보다 우선(하위호환)");
    assert.equal(loaded.sources[1].config.response_mapping_ref, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown response_mapping_ref fails fast at manifest resolution", async () => {
  const { dir, file } = await writeTempManifest({
    schema_version: "collector.source_manifest.v1",
    shared: { response_mappings: { calendar: { adapter: "json_path_mapping" } } },
    sources: [{ config: refSourceConfig("typo_source", "calendr") }],
  });
  try {
    await assert.rejects(() => loadCollectorSourceManifest(file), /Unknown response_mapping_ref: calendr/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
