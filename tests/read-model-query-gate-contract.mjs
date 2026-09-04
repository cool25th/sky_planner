import assert from "node:assert/strict";
import test from "node:test";
import { resolveOffersDataFromPostgres } from "../lib/read-model/offers-query.ts";
import { resolveCalendarDataFromPostgres } from "../lib/read-model/calendar-query.ts";
import { resolveSearchDataFromPostgres } from "../lib/read-model/search-query.ts";

// TEST-20260905-001: read-model 조회 파라미터 게이트 계약 고정.
// 09-02 학습("API 계약을 모르는 채로 빈 응답을 관측하면 결함을 만들어낸다")의 기계화 —
// /offers는 destination+depart+return 전부 필수, /calendar는 stay_bucket≠ALL,
// /search는 destination 입력 필수. 게이트는 DB 접근 앞에서 null(폴백 위임)로 종결한다.

function offersQuery(overrides = {}) {
  return {
    origin: "ICN",
    week: "2026-W37",
    destination: "FUK",
    depart: "2026-09-07",
    return: "2026-09-10",
    cabin: "ALL",
    traveler: "adt1",
    airline: [],
    stops: "ALL",
    ...overrides,
  };
}

function calendarQuery(overrides = {}) {
  return {
    origin: "ICN",
    week: "2026-W37",
    destination: "FUK",
    cabin: "ALL",
    stay_bucket: "3_4",
    traveler: "adt1",
    airlines: [],
    ...overrides,
  };
}

function searchQuery(overrides = {}) {
  return {
    origin: "ICN",
    destination: "FUK",
    destination_input: "후쿠오카",
    days: 4,
    flex_days: 2,
    cabin: "ALL",
    traveler: "adt1",
    ...overrides,
  };
}

// 잡 env에 DATABASE_URL이 주입된 러너(collect-fares)에서도 계약이 결정론적이도록
// 게이트 검증 동안 env를 명시적으로 제어한다(TEST-20260830-001 밀폐 패턴).
const ENV_KEYS = ["DATABASE_READ_URL", "DATABASE_URL"];

function withEnv(overrides, run) {
  return async () => {
    const saved = {};
    for (const key of ENV_KEYS) {
      if (key in process.env) saved[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, overrides);
    try {
      await run();
    } finally {
      for (const key of ENV_KEYS) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };
}

test(
  "postgres 미구성 환경에서는 조회 전에 null로 폴백 위임",
  withEnv({}, async () => {
    assert.equal(await resolveOffersDataFromPostgres(offersQuery(), "2026-09-04T00:00:00Z", []), null);
  }),
);

test(
  "offers는 destination·depart·return 전부 필수 — 결측 시 DB 접근 전 null",
  withEnv({ DATABASE_READ_URL: "postgresql://gate-contract-unused" }, async () => {
    const lastBatchAt = "2026-09-04T00:00:00Z";
    assert.equal(await resolveOffersDataFromPostgres(offersQuery({ depart: "" }), lastBatchAt, []), null);
    assert.equal(await resolveOffersDataFromPostgres(offersQuery({ return: "" }), lastBatchAt, []), null);
    assert.equal(await resolveOffersDataFromPostgres(offersQuery({ destination: "" }), lastBatchAt, []), null);
  }),
);

test(
  "calendar는 stay_bucket=ALL 미지원 — null",
  withEnv({ DATABASE_READ_URL: "postgresql://gate-contract-unused" }, async () => {
    assert.equal(
      await resolveCalendarDataFromPostgres(calendarQuery({ stay_bucket: "ALL" }), "2026-09-04T00:00:00Z", []),
      null,
    );
  }),
);

test(
  "search는 destination 입력 필수 — 공백만으로는 null",
  withEnv({ DATABASE_READ_URL: "postgresql://gate-contract-unused" }, async () => {
    assert.equal(
      await resolveSearchDataFromPostgres(searchQuery({ destination_input: "  ", destination: "" }), "2026-09-04T00:00:00Z", []),
      null,
    );
  }),
);
