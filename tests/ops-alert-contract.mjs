import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeOpsAlertPayload,
  sendOpsAlert,
  validateOpsAlertWebhookUrl,
} from "../scripts/ops-alert-smoke.mjs";

test("ops alert webhook validation rejects local and placeholder URLs", () => {
  assert.equal(validateOpsAlertWebhookUrl("http://localhost:3000/hook").ok, false);
  assert.equal(validateOpsAlertWebhookUrl("https://hooks.example.com/service").ok, false);
  assert.equal(validateOpsAlertWebhookUrl("https://hooks.skyplanner.co.kr/service").ok, true);
});

test("ops alert smoke posts a JSON payload to the configured webhook", async () => {
  let request = null;
  const result = await sendOpsAlert(
    {
      event: "ops_alert_contract_test",
      status: "test",
    },
    {
      webhookUrl: "https://hooks.skyplanner.co.kr/service",
      environment: "test",
      generatedAt: "2026-05-29T03:00:00Z",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 204 };
      },
    },
  );

  assert.equal(result.sent, true);
  assert.equal(result.status, 204);
  assert.equal(request.url, "https://hooks.skyplanner.co.kr/service");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["content-type"], "application/json");
  const body = JSON.parse(request.options.body);
  assert.equal(body.service, "sky_planner");
  assert.equal(body.environment, "test");
  assert.equal(body.event, "ops_alert_contract_test");
  assert.equal(body.generated_at, "2026-05-29T03:00:00Z");
});

test("ops alert smoke reports non-2xx webhook responses as failed delivery", async () => {
  const result = await sendOpsAlert(
    {
      event: "ops_alert_contract_test",
      status: "test",
    },
    {
      webhookUrl: "https://hooks.skyplanner.co.kr/service",
      fetchImpl: async () => ({ ok: false, status: 500 }),
    },
  );

  assert.equal(result.sent, false);
  assert.equal(result.status, 500);
});

test("ops alert payload sanitizer redacts secrets before delivery", async () => {
  let body = null;
  const result = await sendOpsAlert(
    {
      event: "ops_alert_contract_test",
      status: "fail",
      database_url: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
      nested: {
        token: "ops-readiness-secret-123",
        message: "retry with postgresql://user:pass@localhost:5432/db",
      },
      authorization: "Bearer live-secret-token-12345",
    },
    {
      webhookUrl: "https://hooks.skyplanner.co.kr/service",
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, status: 204 };
      },
    },
  );
  const serialized = JSON.stringify(body);

  assert.equal(result.sent, true);
  assert.equal(body.database_url, "[REDACTED]");
  assert.equal(body.nested.token, "[REDACTED]");
  assert.equal(body.nested.message, "retry with [REDACTED_DATABASE_URL]");
  assert.equal(body.authorization, "Bearer [REDACTED]");
  assert.doesNotMatch(serialized, /sky_planner:secret/);
  assert.doesNotMatch(serialized, /user:pass/);
  assert.doesNotMatch(serialized, /ops-readiness-secret-123/);
});

test("ops alert payload sanitizer preserves non-sensitive service context", () => {
  assert.deepEqual(sanitizeOpsAlertPayload({
    event: "service_readiness_not_ready",
    failed_checks: ["collector_manifest_configured"],
    launch_blockers: ["COLLECTOR_SOURCE_MANIFEST_JSON에 실제 운영 source manifest를 주입합니다."],
    metrics: {
      broken_deeplink_rate: 0.1,
      max_broken_deeplink_rate: 0.05,
    },
  }), {
    event: "service_readiness_not_ready",
    failed_checks: ["collector_manifest_configured"],
    launch_blockers: ["COLLECTOR_SOURCE_MANIFEST_JSON에 실제 운영 source manifest를 주입합니다."],
    metrics: {
      broken_deeplink_rate: 0.1,
      max_broken_deeplink_rate: 0.05,
    },
  });
});
