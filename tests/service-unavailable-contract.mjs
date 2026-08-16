import assert from "node:assert/strict";
import test from "node:test";

import {
  isServiceUnavailableDiagnostics,
  serviceUnavailableNotice,
} from "../lib/service-unavailable.ts";

test("service unavailable diagnostics classify suppressed read model failures", () => {
  assert.equal(isServiceUnavailableDiagnostics({ service_unavailable: true }), true);
  assert.equal(isServiceUnavailableDiagnostics({ read_model: "unavailable", fallback_suppressed: true }), true);
  assert.equal(isServiceUnavailableDiagnostics({
    service_requires_postgres: true,
    source_readiness: { status: "not_ready" },
  }), true);
  assert.equal(isServiceUnavailableDiagnostics({ fallback_used: true, read_model: "mock" }), false);
  assert.equal(isServiceUnavailableDiagnostics({ source_health_error: "postgres_source_health_query_failed" }), false);
  assert.equal(isServiceUnavailableDiagnostics(null), false);
});

test("service unavailable notice does not expose backend failure details", () => {
  const notice = serviceUnavailableNotice({
    service_unavailable: true,
    fallback_reason: "password authentication failed for user sky_planner",
    source_health_error: "postgres_source_health_query_failed",
  });
  const payload = JSON.stringify(notice);

  assert.match(notice.title, /운임 데이터를 표시할 수 없습니다/);
  assert.match(notice.detailLabel, /Source health/);
  assert.doesNotMatch(payload, /password/i);
  assert.doesNotMatch(payload, /authentication/i);
  assert.doesNotMatch(payload, /sky_planner/i);
});

test("service unavailable notice names source readiness without exposing internals", () => {
  const notice = serviceUnavailableNotice({
    service_unavailable: true,
    source_readiness: {
      status: "not_ready",
      blocked_source_ids: ["skyscanner_affiliate"],
      readiness_blockers: ["last_batch_completed_with_failures"],
    },
  });
  const payload = JSON.stringify(notice);

  assert.match(notice.detailLabel, /Source readiness/);
  assert.doesNotMatch(payload, /skyscanner_affiliate/);
  assert.doesNotMatch(payload, /last_batch_completed_with_failures/);
});
