import assert from "node:assert/strict";
import test from "node:test";
import { dataModeLabel, defaultBatchAt, resolveMapResponse, resolveMetaResponse } from "../lib/data-source.ts";
import { availableWeeks } from "../lib/mock-market.ts";

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
  assert.equal(dataModeLabel({ data_mode: "last_good" }), "마지막 수집 데이터");
  assert.equal(dataModeLabel({ data_mode: "unavailable" }), "데이터 일시 중단");
  assert.equal(dataModeLabel(undefined), "데모 데이터");
});

test("meta response keeps envelope shape on the mock path", hermeticMockEnv(async () => {
  const response = await resolveMetaResponse();
  assert.equal(response.diagnostics.data_mode, "demo");
  assert.ok(response.data.regions.length > 0);
  assert.ok(defaultBatchAt().length > 0);
}));

// INT-20260829-001: generated_at은 응답 생성 시각이다 — mock 빌드 상수(고정 11:30)가 아님.
test("responses report actual generation time, not the mock build constant", hermeticMockEnv(async () => {
  const before = Date.now();
  const response = await resolveMapResponse(mapQuery());
  const generated = Date.parse(response.generated_at);
  assert.ok(Number.isFinite(generated), `generated_at not ISO: ${response.generated_at}`);
  assert.ok(
    generated >= before - 1000 && generated <= Date.now() + 1000,
    `generated_at ${response.generated_at} is not ~now`,
  );
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

// DATA-20260908-001 완료 기준: 운영(SERVICE_REQUIRE_POSTGRES)에서 게이트 차단·쿼리 실패 시
// 데모 페이로드/데모 라벨이 나오는 경로가 존재해선 안 된다 — last-good 조회도 실패하면
// 빈 live 형태 + 사유로 응답한다. 2026-09-08 프로덕션 사건(26분 빈 지도+데모 라벨) 방어.
test("production fallback never ships demo payload or demo label", async () => {
  process.env.SERVICE_REQUIRE_POSTGRES = "1";
  process.env.DATABASE_READ_URL = "postgresql://contract:nodb@127.0.0.1:1/none"; // postgresConfigured만 참(즉시 실패)
  try {
    const response = await resolveMapResponse(mapQuery());
    assert.equal(response.diagnostics.data_mode, "unavailable");
    assert.deepEqual(response.data.deals, [], "suppressed fallback must not carry mock deals");
    assert.deepEqual(response.data.available_airlines, []);
    assert.notEqual(dataModeLabel(response.diagnostics), "데모 데이터", "unavailable mode must not wear the demo label");
    assert.ok(
      response.warning_flags.includes("service_read_model_unavailable"),
      `warning_flags: ${response.warning_flags.join(",")}`,
    );
    assert.ok(response.diagnostics.fallback_reason, "suppressed fallback must name a reason");
  } finally {
    delete process.env.SERVICE_REQUIRE_POSTGRES;
    delete process.env.DATABASE_READ_URL;
  }
});

// H1(2026-09-08 핫픽스): 프로덕션 실측 service_requires_postgres=false — REQUIRE 플래그 없이
// postgres만 구성돼도(운영 조건) 쿼리 실패는 mock이 아니라 빈 결과로 떨어져야 한다.
test("configured postgres rejects mock payload even without SERVICE_REQUIRE_POSTGRES", async () => {
  if ("SERVICE_REQUIRE_POSTGRES" in process.env) delete process.env.SERVICE_REQUIRE_POSTGRES;
  process.env.DATABASE_READ_URL = "postgresql://contract:nodb@127.0.0.1:1/none";
  try {
    const response = await resolveMapResponse(mapQuery());
    assert.equal(response.diagnostics.postgres_configured, true);
    assert.notEqual(response.diagnostics.service_requires_postgres, true);
    assert.notEqual(response.diagnostics.data_mode, "demo", "운영 조건(postgres 구성)에서 쿼리 실패가 데모로 떨어지면 H1 구멍");
    assert.notEqual(response.diagnostics.read_model, "mock");
    assert.deepEqual(response.data.deals, []);
    assert.equal(response.diagnostics.fallback_reason, "postgres_connection_failed");
  } finally {
    delete process.env.DATABASE_READ_URL;
  }
});

// H2(2026-09-08 핫픽스): last-good은 스테일(신선도 마감) 차단만 완화한다 — 일시정지·서킷브레이커·
// 반복 실패로 차단된 소스의 데이터가 last-good 응답의 source_flags/오퍼로 되살아나면 실패.
test("last-good flags never revive paused, circuit-broken or failing sources", async () => {
  const { lastGoodSourceFlags } = await import("../lib/data-source.ts");
  const flags = lastGoodSourceFlags({
    sourceFlags: [],
    readiness: null,
    sourceHealthError: null,
    sourceBlockReasons: {
      travelpayouts_aviasales: "stale",
      skyscanner_affiliate: "paused",
      korean_air_official: "circuit_breaker_open",
      asiana_official: "consecutive_failures",
    },
  });
  assert.ok(flags.includes("travelpayouts_aviasales"), "스테일 차단은 last-good 완화 대상");
  assert.ok(!flags.includes("skyscanner_affiliate"), "일시정지 소스 부활 금지");
  assert.ok(!flags.includes("korean_air_official"), "서킷브레이커 소스 부활 금지");
  assert.ok(!flags.includes("asiana_official"), "반복 실패 소스 부활 금지");

  const allRevivableBlocked = lastGoodSourceFlags({
    sourceFlags: [],
    readiness: null,
    sourceHealthError: null,
    sourceBlockReasons: { skyscanner_affiliate: "paused", asiana_official: "circuit_breaker_open" },
  });
  assert.equal(allRevivableBlocked.filter((flag) => flag !== "korean_air_official" && flag !== "travelpayouts_aviasales").length, 0);
});

// DATA-20260908-001: 빈 결과·last-good용 엔드포인트별 빈 형태도 live envelope과 같은 모양을 유지한다.
test("offers and calendar empty builders return live-shaped empty data", async () => {
  const { emptyOffersDataForQuery } = await import("../lib/read-model/offers-query.ts");
  const { emptyCalendarDataForQuery } = await import("../lib/read-model/calendar-query.ts");

  const offersQuery = {
    origin: "ICN",
    week: availableWeeks(1)[0].code,
    destination: "TYO",
    depart: "2026-09-21",
    return: "2026-09-25",
    cabin: "ALL",
    traveler: "adt1",
    airline: [],
    stops: "ALL",
  };
  const emptyOffers = emptyOffersDataForQuery(offersQuery);
  assert.ok(emptyOffers);
  assert.deepEqual(emptyOffers.offers, []);
  assert.deepEqual(emptyOffers.summary, { count: 0, lowest_total: null, last_seen_at: null });

  const calendarQuery = { ...offersQuery, stay_bucket: "5_7", airlines: [] };
  const emptyCalendar = emptyCalendarDataForQuery(calendarQuery);
  assert.ok(emptyCalendar);
  assert.equal(emptyCalendar.destination, null);
  assert.deepEqual(emptyCalendar.cells, []);
  assert.deepEqual(emptyCalendar.departure_dates, []);
});

// INT-20260908-001: 승인 소스 전부 차단(스테일 연쇄) 시 map/calendar/offers의 소스 게이트가
// 쿼리 실행 없이 null을 반환한다 — 폴백 사유는 "행 없음"(데이터 부재)이 아니라
// "적격 소스 없음"(배치 스테일)이어야 오퍼레이터가 원인을 구분할 수 있다.
// 2026-09-08 프로덕션 실측: 배치 24.1h 스테일로 전 소스 차단 → not_ready → 데모 폴백에서
// fallback_reason이 postgres_no_matching_rows로 오분류된 것이 계기.
// H1 핫픽스로 postgres 구성 환경의 mock 폴백는 제거 — 이 경로도 unavailable+빈 결과로 응답한다.
test("source-gate fallback reports no eligible sources, not no matching rows", async () => {
  const { SOURCE_POLICY_CATALOG } = await import("../lib/source-policy.ts");
  const saved = { DATABASE_READ_URL: process.env.DATABASE_READ_URL, SERVICE_REQUIRE_POSTGRES: process.env.SERVICE_REQUIRE_POSTGRES };
  process.env.DATABASE_READ_URL = "postgresql://contract:nodb@127.0.0.1:1/none"; // postgresConfigured만 참으로(접속은 즉시 실패)
  delete process.env.SERVICE_REQUIRE_POSTGRES;
  const killSwitches = SOURCE_POLICY_CATALOG.map((source) => source.env_flag);
  const savedSwitches = {};
  for (const flag of killSwitches) {
    savedSwitches[flag] = process.env[flag];
    process.env[flag] = "false";
  }
  try {
    const response = await resolveMapResponse(mapQuery());
    assert.equal(response.diagnostics.read_model, "unavailable");
    assert.equal(response.diagnostics.fallback_reason, "postgres_no_eligible_sources");
    assert.deepEqual(response.data.deals, [], "적격 소스 0개일 때 데모 딜이 실리면 안 된다");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of Object.entries(savedSwitches)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
