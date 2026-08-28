import assert from "node:assert/strict";
import test from "node:test";

import { availableWeeks } from "../lib/mock-market.ts";
import { dataModeLabel, defaultBatchAt, resolveMapResponse, resolveMetaResponse } from "../lib/data-source.ts";

// TEST-20260822-002: BFF 데이터 경로 계약 — DB 미구성 테스트 프로세스에서
// mock 폴백 진단·data_mode 라벨·suppressMockFallback 분기를 직접 검증한다.

function mapQuery() {
  return {
    origin: "ICN",
    week: availableWeeks(1)[0].code,
    region: "ALL",
    cabin: "ALL",
    stay_bucket: "5_7",
    traveler: "adt1",
    airlines: [],
    budget: null,
  };
}

test("mock fallback diagnostics mark data as demo", async () => {
  const response = await resolveMapResponse(mapQuery());
  assert.equal(response.diagnostics.data_mode, "demo");
  assert.equal(dataModeLabel(response.diagnostics), "데모 데이터");
  assert.ok(Array.isArray(response.data.deals) && response.data.deals.length > 0, "mock path must return deals");
  for (const key of ["request_id", "generated_at", "last_batch_at"]) {
    assert.ok(response[key], `envelope missing ${key}`);
  }
});

test("dataModeLabel maps only live diagnostics to the live label", () => {
  assert.equal(dataModeLabel({ data_mode: "live" }), "실시간 데이터");
  assert.equal(dataModeLabel({ data_mode: "demo" }), "데모 데이터");
  assert.equal(dataModeLabel(undefined), "데모 데이터");
});

test("meta response keeps envelope shape on the mock path", async () => {
  const response = await resolveMetaResponse();
  assert.equal(response.diagnostics.data_mode, "demo");
  assert.ok(response.data.regions.length > 0);
  assert.ok(defaultBatchAt().length > 0);
});

test("SERVICE_REQUIRE_POSTGRES suppresses mock fallback into unavailable diagnostics", async () => {
  process.env.SERVICE_REQUIRE_POSTGRES = "1";
  try {
    const response = await resolveMapResponse(mapQuery());
    assert.equal(response.diagnostics.data_mode, "unavailable");
    assert.ok(
      response.warning_flags.includes("service_read_model_unavailable"),
      `warning_flags: ${response.warning_flags.join(",")}`,
    );
  } finally {
    delete process.env.SERVICE_REQUIRE_POSTGRES;
  }
});

// UX-20260828-001(a): 0행 쿼리는 mock 폴백이 아니라 빈 live MapData로 응답한다.
test("emptyMapDataForQuery returns truthy live-shaped empty data, not null", async () => {
  const { emptyMapDataForQuery } = await import("../lib/read-model/map-query.ts");
  const query = mapQuery();
  const empty = emptyMapDataForQuery(query);
  assert.ok(empty, "empty result must be truthy so the resolver reports live instead of falling back to mock");
  assert.deepEqual(empty.deals, []);
  assert.deepEqual(empty.available_airlines, []);
  assert.deepEqual(empty.summary, { destinations: 0, offers_considered: 0, last_seen_at: null });
  assert.equal(empty.week, query.week);
  assert.equal(empty.stay_bucket, query.stay_bucket);
});
