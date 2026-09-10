import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateLaunchGate, isObservationEvidenceFresh, OBSERVATION_EVIDENCE_MAX_AGE_HOURS } from "../lib/launch-gate.ts";
import {
  effectiveMaxStaleHours,
  STALE_HARD_CAP_HOURS,
  STALE_SAFETY_BUFFER_HOURS,
} from "../lib/source-policy.ts";
import {
  buildTpFieldSelection,
  collectTpClickStats,
  extractTpFieldNames,
  parseTpStatsRows,
  targetStatDate,
} from "../scripts/collect-tp-click-stats.mjs";
import { countDedupViolations, runSyntheticCheck, SYNTHETIC_PRODUCT_THRESHOLDS } from "../scripts/ops-synthetic-check.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// UX-20260910-005/006/007: 계정 없는 계측·자동화 — 클릭 회수 잡·동적 가시 창·관측 증거 게이트.
// 2026-09-11: 구 /v2/statistics/sales 폐기(404)로 statistics v1 execute_query로 마이그레이션.

const tpFieldsFixture = {
  success: true,
  data: [
    "date", "sub_id", "redirects_count", "inits_count", "searches_count",
    "paid_actions_count", "processing_actions_count", "cancelled_actions_count",
    "paid_profit_krw_sum", "processing_profit_krw_sum",
  ],
};

const tpQueryFixture = {
  success: true,
  data: [
    {
      group: { sub_id: "home-pick_weekend_1" },
      redirects_count: 3, inits_count: 4, searches_count: 6,
      paid_actions_count: 1, processing_actions_count: 0, cancelled_actions_count: 0,
      paid_profit_krw_sum: 920, processing_profit_krw_sum: 30,
    },
    {
      group: { sub_id: "offers_BKI_fresh" },
      redirects_count: 1, inits_count: 1, searches_count: 1,
      paid_actions_count: 0, processing_actions_count: 0, cancelled_actions_count: 0,
      paid_profit_krw_sum: 0, processing_profit_krw_sum: 0,
    },
  ],
};

function tpFetchImpl(captured = [], { fieldsPayload = tpFieldsFixture, queryPayload = tpQueryFixture } = {}) {
  return async (url, init) => {
    captured.push([url, init]);
    if (url.includes("get_fields_list")) {
      return { ok: true, status: 200, json: async () => fieldsPayload };
    }
    return { ok: true, status: 200, json: async () => queryPayload };
  };
}

test("TP statistics v1 field discovery maps candidates and flags missing currency", () => {
  assert.deepEqual(extractTpFieldNames(tpFieldsFixture), tpFieldsFixture.data);
  assert.deepEqual(extractTpFieldNames({ data: [{ field_name: "date" }, { field_name: "sub_id" }] }), ["date", "sub_id"]);
  assert.deepEqual(extractTpFieldNames({ data: {} }), [], "스키마 이탈은 soft-fail");

  const selection = buildTpFieldSelection(tpFieldsFixture.data);
  assert.equal(selection.picked.clicks, "redirects_count");
  assert.ok(selection.queryFields.includes("paid_profit_krw_sum"));
  assert.ok(selection.queryFields.includes("processing_profit_krw_sum"), "수익 성분은 가용 전부");
  assert.equal(selection.profitLimited, false);

  // krw 수익 필드가 없으면 profit 0 + 플래그(통화 추측 적재 금지).
  const limited = buildTpFieldSelection(["date", "sub_id", "redirects_count", "paid_actions_count"]);
  assert.equal(limited.profitLimited, true);
  assert.ok(!limited.queryFields.includes("paid_profit_krw_sum"));

  // 필드 목록 파식(빈 배열)은 문서 표준 이름으로 시도한다.
  const fallback = buildTpFieldSelection([]);
  assert.equal(fallback.picked.clicks, "redirects_count");
});

test("TP statistics v1 rows map to the schema (clicks=redirects, bookings 합산, paid_clicks 0)", () => {
  const selection = buildTpFieldSelection(tpFieldsFixture.data);
  const rows = parseTpStatsRows(tpQueryFixture, "2026-09-09", selection);
  assert.equal(rows.length, 2);
  const pick = rows.find((row) => row.sub_id === "home-pick_weekend_1");
  assert.equal(pick.clicks, 3, "클릭 = redirects_count");
  assert.equal(pick.visitors, 4);
  assert.equal(pick.searches, 6);
  assert.equal(pick.paid_bookings, 1);
  assert.equal(pick.bookings, 1, "유료+진행+취소 합산");
  assert.equal(pick.profit_krw, 950, "유료 920 + 진행 30");
  assert.equal(pick.paid_clicks, 0, "v1 aggregated에 유료클릭 구분 없음 — 0 적재 계약");
  assert.equal(pick.stat_date, "2026-09-09");
  const offers = rows.find((row) => row.sub_id === "offers_BKI_fresh");
  assert.equal(offers.clicks, 1);
  assert.deepEqual(parseTpStatsRows({ data: {} }, "2026-09-09", selection), [], "스키마 이탈은 공집합");
  // sub_id 미표기 그룹(null)도 놓치지 않는다 — 빈 문자열로 집계.
  const untagged = parseTpStatsRows({ data: [{ redirects_count: 2 }] }, "2026-09-09", selection);
  assert.equal(untagged[0].sub_id, "");
});

test("click collector targets yesterday KST, queries v1 with token header, and skips softly", async () => {
  const now = new Date("2026-09-10T05:00:00Z"); // KST 09-10 14:00
  assert.equal(targetStatDate(now), "2026-09-09");
  assert.equal(targetStatDate(now, "2026-09-01"), "2026-09-01");
  const report = await collectTpClickStats({ now, token: "", dryRun: true });
  assert.equal(report.status, "skipped_no_token", "토큰 미설정은 배치를 실패시키지 않는다");

  const apiFail = await collectTpClickStats({
    now,
    token: "t",
    dryRun: true,
    fetchImpl: async () => ({ ok: false, status: 502 }),
  });
  assert.equal(apiFail.status, "api_failed");

  const captured = [];
  const dry = await collectTpClickStats({ now, token: "tok", dryRun: true, fetchImpl: tpFetchImpl(captured) });
  assert.equal(dry.status, "dry_run");
  assert.equal(dry.rows, 2);
  assert.equal(dry.sample[0].sub_id, "home-pick_weekend_1");
  assert.equal(dry.profit_currency_limited, false);

  // 요청 계약: v1 execute_query · X-Access-Token 헤더 · date 범위 필터 · sub_id 그룹.
  const [fieldsUrl] = captured[0];
  assert.ok(fieldsUrl.includes("/statistics/v1/get_fields_list"));
  const [queryUrl, queryInit] = captured[1];
  assert.ok(queryUrl.includes("/statistics/v1/execute_query"));
  assert.equal(queryInit.method, "POST");
  assert.equal(queryInit.headers["X-Access-Token"], "tok");
  const body = JSON.parse(queryInit.body);
  assert.deepEqual(body.group, ["sub_id"]);
  assert.ok(body.fields.includes("sub_id"), "그룹 필드는 fields에도 포함(문서 예시 형태)");
  assert.deepEqual(body.filters, [
    { field: "date", op: "ge", value: "2026-09-09" },
    { field: "date", op: "le", value: "2026-09-09" },
  ]);
  assert.ok(Array.isArray(body.fields) && body.fields.length > 0);

  // 폐기된 구 엔드포인트로의 회귀 금지.
  const script = readFileSync(join(repoRoot, "scripts/collect-tp-click-stats.mjs"), "utf8");
  assert.doesNotMatch(script, /\/v2\/statistics\/sales/);
});

test("visibility window covers delayed batches and caps at 14 days", () => {
  // UX-20260910-006 경계값: 25h/49h 지연 시나리오 — 인벤토리 0 방지가 불변식.
  const now = new Date("2026-09-10T12:00:00Z");
  const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000);
  const at25h = effectiveMaxStaleHours({ lastObservedAt: hoursAgo(25), now, baseHours: 24 });
  assert.ok(at25h >= 25, `25h 지연 관측을 커버해야 한다(실제 ${at25h}h)`);
  const at49h = effectiveMaxStaleHours({ lastObservedAt: hoursAgo(49), now, baseHours: 24 });
  assert.ok(at49h >= 49, `49h 지연 관측을 커버해야 한다(실제 ${at49h}h)`);
  assert.equal(effectiveMaxStaleHours({ lastObservedAt: hoursAgo(1), now, baseHours: 24 }), 24, "정상 시 env 상한 유지");
  assert.equal(effectiveMaxStaleHours({ lastObservedAt: hoursAgo(1), now, baseHours: 48 }), 48, "env 미설정 시 기본 48");
  assert.equal(
    effectiveMaxStaleHours({ lastObservedAt: hoursAgo(30 * 24), now, baseHours: 24 }),
    STALE_HARD_CAP_HOURS,
    "절대 상한 14일",
  );
  assert.equal(STALE_SAFETY_BUFFER_HOURS, 6);
  // 워크플로가 잡을 싣고, 배치 스텝이 스크립트를 실행하는지 소스 고정.
  const batchYml = readFileSync(join(repoRoot, ".github/workflows/daily-batch.yml"), "utf8");
  assert.match(batchYml, /node scripts\/collect-tp-click-stats\.mjs/);
});

test("observation evidence freshness gates the failure-detection axis, not the webhook", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const iso = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
  assert.equal(isObservationEvidenceFresh(iso(11), now), true, "12h 내 실행 증거는 신선");
  assert.equal(isObservationEvidenceFresh(iso(13), now), false, "12h 초과는 만료");
  assert.equal(isObservationEvidenceFresh(null, now), false, "기록 없음 = 증거 없음");
  assert.equal(OBSERVATION_EVIDENCE_MAX_AGE_HOURS, 12);

  // 관측 증거 없이 passed=true가 되는 경로 금지: 판정 입력은 하트비트에서만 나온다.
  const gateSource = readFileSync(join(repoRoot, "lib/launch-gate.ts"), "utf8");
  assert.match(gateSource, /failureDetectionReady: observationEvidence/);
  assert.doesNotMatch(gateSource, /failureDetectionReady: Boolean\(String\(env\.OPS_ALERT_WEBHOOK_URL/);
  assert.match(gateSource, /webhookConfigured: Boolean/);
  // 웹훅은 표시용 추가 신호 — 증거가 없으면 웹훅 설정과 무관하게 축은 실패해야 한다.
  const passing = (overrides = {}) => evaluateLaunchGate({
    dealOfferJoinRatio: 1, weeklyPickableDeals: 10, demoObserved: false, defaultViewCities: 7, ...overrides,
  });
  assert.equal(passing({ failureDetectionReady: true, webhookConfigured: false }).passed, true);
  assert.equal(passing({ failureDetectionReady: false, webhookConfigured: true }).passed, false, "웹훅 설정만으로 게이트가 열리지 않는다");
});

test("synthetic check measures product metrics and fails on threshold breach", async () => {
  assert.equal(countDedupViolations([
    { depart_date: "d", return_date: "r", price_total: 1, airline_code: "AK" },
    { depart_date: "d", return_date: "r", price_total: 1, airline_code: "AK" },
  ]), 1, "동일 조합 2건 = 위반 1");
  assert.equal(countDedupViolations([
    { depart_date: "d", return_date: "r", price_total: 1, airline_code: "AK" },
    { depart_date: "d", return_date: "r", price_total: 2, airline_code: "AK" },
  ]), 0);

  const makeJson = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const healthy = await runSyntheticCheck({
    fetchImpl: async (url) => {
      if (url.includes("/api/deals/map")) {
        return makeJson({ diagnostics: { data_mode: "live" }, data: { deals: [
          { destination_code: "BKI", economy_best_depart_date: "2026-09-13", economy_best_return_date: "2026-09-18" },
          { destination_code: "CEB" }, { destination_code: "DAD" }, { destination_code: "GUM" }, { destination_code: "TYO" },
        ] } });
      }
      if (url.includes("/api/offers")) {
        return makeJson({ data: { offers: [
          { depart_date: "2026-09-13", return_date: "2026-09-18", price_total: 213431, airline_code: "AK" },
        ] } });
      }
      return makeJson({ checks: [{ id: "weekly_picks_present", detail: "픽 가능 딜 101건" }] });
    },
  });
  assert.equal(healthy.status, "pass");
  assert.equal(healthy.map_cities, 5);
  assert.equal(healthy.offers_dedup_violations, 0);
  assert.equal(healthy.pickable_deals, 101);

  const regressed = await runSyntheticCheck({
    fetchImpl: async (url) => {
      if (url.includes("/api/deals/map")) {
        return makeJson({ diagnostics: { data_mode: "live" }, data: { deals: [
          { destination_code: "BKI", economy_best_depart_date: "2026-09-13", economy_best_return_date: "2026-09-18" },
          { destination_code: "CEB" },
        ] } });
      }
      if (url.includes("/api/offers")) {
        return makeJson({ data: { offers: [
          { depart_date: "2026-09-13", return_date: "2026-09-18", price_total: 1, airline_code: "AK" },
          { depart_date: "2026-09-13", return_date: "2026-09-18", price_total: 1, airline_code: "AK" },
        ] } });
      }
      return makeJson({ checks: [{ id: "weekly_picks_present", detail: "픽 가능 딜 0건" }] });
    },
  });
  assert.equal(regressed.status, "fail");
  assert.deepEqual(regressed.regressions, [
    `map cities 2 < ${SYNTHETIC_PRODUCT_THRESHOLDS.minMapCities}`,
    `offers dedup violations 1 > ${SYNTHETIC_PRODUCT_THRESHOLDS.maxOffersDedupViolations}`,
    `pickable deals 0 < ${SYNTHETIC_PRODUCT_THRESHOLDS.minWeeklyPickableDeals}`,
  ]);

  // 하트비트 기록 스텝이 워크플로에 존재하는지 소스 고정.
  const synthYml = readFileSync(join(repoRoot, ".github/workflows/synthetic-check.yml"), "utf8");
  assert.match(synthYml, /node scripts\/ops-synthetic-check\.mjs/);
});

test("synthetic heartbeat is written by the runner ingest role, never the BFF", () => {
  // BFF(read 롤)에 쓰기 경로를 만들면 ADR-006 계정 분리가 깨진다 — 러너가 ingest 롤로 직접 기록.
  const script = readFileSync(join(repoRoot, "scripts/ops-synthetic-check.mjs"), "utf8");
  assert.match(script, /DATABASE_INGEST_URL/);
  assert.match(script, /INSERT INTO batch_state/, "batch_state 하트비트 upsert");
  assert.ok(!existsSync(join(repoRoot, "app/api/ops/heartbeat")), "앱 런타임 하트비트 쓰기 라우트가 없어야 한다");
  const synthYml = readFileSync(join(repoRoot, ".github/workflows/synthetic-check.yml"), "utf8");
  assert.match(synthYml, /npm install --no-save pg/, "러너 최소 의존성 설치");
  assert.match(synthYml, /DATABASE_INGEST_URL/);
});

test("launch-gate 503 body still yields the pickable metric", async () => {
  // 게이트 실패 = 라우트 503(설계) — 관측 스크립트는 본문의 축 값을 읽는다(관측≠판정).
  const makeJson = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
  const result = await runSyntheticCheck({
    fetchImpl: async (url) => {
      if (url.includes("/api/deals/map")) {
        return makeJson({ diagnostics: { data_mode: "live" }, data: { deals: [
          { destination_code: "BKI" }, { destination_code: "CEB" }, { destination_code: "DAD" },
          { destination_code: "GUM" }, { destination_code: "TYO" },
        ] } });
      }
      if (url.includes("/api/offers")) return makeJson({ data: { offers: [] } });
      return makeJson({ passed: false, checks: [{ id: "weekly_picks_present", detail: "픽 가능 딜 96건" }] }, 503);
    },
  });
  assert.equal(result.status, "pass", "503 본문 파싱 실패는 관측 실패가 아니다");
  assert.equal(result.pickable_deals, 96);
});
