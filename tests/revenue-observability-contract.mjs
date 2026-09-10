import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateLaunchGate, isObservationEvidenceFresh, OBSERVATION_EVIDENCE_MAX_AGE_HOURS } from "../lib/launch-gate.ts";
import {
  effectiveMaxStaleHours,
  STALE_HARD_CAP_HOURS,
  STALE_SAFETY_BUFFER_HOURS,
} from "../lib/source-policy.ts";
import { collectTpClickStats, parseTpSalesResponse, targetStatDate } from "../scripts/collect-tp-click-stats.mjs";
import { countDedupViolations, runSyntheticCheck, SYNTHETIC_PRODUCT_THRESHOLDS } from "../scripts/ops-synthetic-check.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// UX-20260910-005/006/007: 계정 없는 계측·자동화 — 클릭 회수 잡·동적 가시 창·관측 증거 게이트.

const tpSalesFixture = {
  success: true,
  data: {
    sales: {
      "2026-09-09": {
        "home-pick_weekend_1": {
          flights: { visitors: 3, searches: 5, clicks: 2, paid_clicks: 1, paid_clicks_profit: 120, bookings: 0, paid_bookings: 0, paid_bookings_profit: 0, pending_bookings_profit: 30 },
          hotels: { visitors: 1, searches: 1, clicks: 1, paid_clicks: 0, paid_clicks_profit: 0, bookings: 1, paid_bookings: 1, paid_bookings_profit: 800, pending_bookings_profit: 0 },
        },
        "offers_BKI_fresh": {
          flights: { visitors: 1, searches: 1, clicks: 1, paid_clicks: 0, paid_clicks_profit: 0, bookings: 0, paid_bookings: 0, paid_bookings_profit: 0, pending_bookings_profit: 0 },
        },
      },
    },
  },
};

test("TP sales response parses into (date, sub_id, metrics) rows summing flights+hotels", () => {
  const rows = parseTpSalesResponse(tpSalesFixture, "2026-09-09");
  assert.equal(rows.length, 2);
  const pick = rows.find((row) => row.sub_id === "home-pick_weekend_1");
  assert.equal(pick.clicks, 3, "flights 2 + hotels 1");
  assert.equal(pick.bookings, 1);
  assert.equal(pick.paid_bookings, 1);
  assert.equal(pick.profit_krw, 950, "유료클릭 120 + 유료예약 800 + 확정 대기 30");
  assert.equal(pick.visitors, 4);
  const offers = rows.find((row) => row.sub_id === "offers_BKI_fresh");
  assert.equal(offers.clicks, 1);
  assert.deepEqual(parseTpSalesResponse(tpSalesFixture, "2026-09-08"), [], "대상 날짜 외는 공집합");
  assert.deepEqual(parseTpSalesResponse({ data: {} }, "2026-09-09"), [], "스키마 이탈은 soft-fail");
});

test("click collector targets yesterday KST and skips softly without a token", async () => {
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
  // dry-run(실응답 파싱만, 적재 없음) 경로가 스키마를 그대로 통과하는지도 고정.
  const dry = await collectTpClickStats({
    now,
    token: "t",
    dryRun: true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => tpSalesFixture }),
  });
  assert.equal(dry.status, "dry_run");
  assert.equal(dry.rows, 2);
  assert.equal(dry.sample[0].sub_id, "home-pick_weekend_1");
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
  assert.match(synthYml, /DATABASE_INGEST_URL/);
});
