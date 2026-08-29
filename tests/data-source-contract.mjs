import assert from "node:assert/strict";
import test from "node:test";

import { availableWeeks } from "../lib/mock-market.ts";
import { dataModeLabel, defaultBatchAt, resolveMapResponse, resolveMetaResponse } from "../lib/data-source.ts";

// TEST-20260822-002: BFF 데이터 경로 계약 — DB 미구성 테스트 프로세스에서
// mock 폴백 진단·data_mode 라벨·suppressMockFallback 분기를 직접 검증한다.

// TEST-20260830-001: mock 경로 계약은 러너 env에 반응하지 않는다(밀폐).
// collect-fares 잡 env(DATABASE_URL·SERVICE_REQUIRE_POSTGRES 주입)에서 live 경로로
// 흘러 실배치를 실패시킨 사례 방어 — mock 계약 테스트 동안 env를 차단·복원한다.
function hermeticMockEnv(run) {
  return async () => {
    const KEYS = ["DATABASE_READ_URL", "DATABASE_URL", "SERVICE_REQUIRE_POSTGRES"];
    const saved = {};
    for (const key of KEYS) {
      if (key in process.env) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }
    try {
      await run();
    } finally {
      for (const [key, value] of Object.entries(saved)) process.env[key] = value;
    }
  };
}

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

test("mock fallback diagnostics mark data as demo", hermeticMockEnv(async () => {
  const response = await resolveMapResponse(mapQuery());
  assert.equal(response.diagnostics.data_mode, "demo");
  assert.equal(dataModeLabel(response.diagnostics), "데모 데이터");
  assert.ok(Array.isArray(response.data.deals) && response.data.deals.length > 0, "mock path must return deals");
  for (const key of ["request_id", "generated_at", "last_batch_at"]) {
    assert.ok(response[key], `envelope missing ${key}`);
  }
}));

test("dataModeLabel maps only live diagnostics to the live label", () => {
  assert.equal(dataModeLabel({ data_mode: "live" }), "실시간 데이터");
  assert.equal(dataModeLabel({ data_mode: "demo" }), "데모 데이터");
  assert.equal(dataModeLabel(undefined), "데모 데이터");
});

test("meta response keeps envelope shape on the mock path", hermeticMockEnv(async () => {
  const response = await resolveMetaResponse();
  assert.equal(response.diagnostics.data_mode, "demo");
  assert.ok(response.data.regions.length > 0);
  assert.ok(defaultBatchAt().length > 0);
}));

test("SERVICE_REQUIRE_POSTGRES suppresses mock fallback into unavailable diagnostics", hermeticMockEnv(async () => {
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
}));

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

// UX-20260828-001 잔여: calendar·offers도 0행 시 빈 live 형태로 응답한다(가드 삭제로 자연 처리).
// 이 계약이 깨지면(빈 입력이 예외 또는 null 반환) resolve*FromPostgres의 가드 삭제가 무너진다.
test("buildCalendarDataFromOffers renders live-shaped empty calendar for zero offers", async () => {
  const { buildCalendarDataFromOffers } = await import("../lib/read-model-source-filter.ts");
  const query = {
    origin: "ICN",
    week: availableWeeks(1)[0].code,
    destination: "TYO",
    stay_bucket: "5_7",
    traveler: "adt1",
    cabin: "ALL",
    airlines: [],
  };
  const destination = {
    code: "TYO",
    city: "도쿄",
    country: "일본",
    region_code: "ASIA",
    region_label: "아시아",
    lat: 35.68,
    lon: 139.69,
  };

  const withDestination = buildCalendarDataFromOffers(query, destination, []);
  assert.ok(withDestination, "zero-offer calendar must stay truthy so the resolver reports live");
  assert.equal(withDestination.destination?.code, "TYO");
  assert.deepEqual(withDestination.cells, []);
  assert.deepEqual(withDestination.departure_dates, []);
  assert.deepEqual(withDestination.return_dates, []);

  const withoutDestination = buildCalendarDataFromOffers(query, null, []);
  assert.ok(withoutDestination, "destination-less calendar (past week) must also return truthy live data");
  assert.equal(withoutDestination.destination, null);
  assert.deepEqual(withoutDestination.cells, []);
});
