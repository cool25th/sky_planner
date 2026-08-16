import assert from "node:assert/strict";
import test from "node:test";

import { serviceApiReadinessBlockReason } from "../lib/service-api-readiness.ts";

test("service API blocks postgres responses when source readiness is not ready", () => {
  const env = { SERVICE_REQUIRE_POSTGRES: "true" };

  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: true,
    sourceReadiness: { status: "ready" },
    sourceHealthError: null,
  }, env), null);
  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: true,
    sourceReadiness: { status: "not_ready" },
    sourceHealthError: null,
  }, env), "source_readiness_not_ready");
  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: true,
    sourceReadiness: null,
    sourceHealthError: null,
  }, env), "source_readiness_unavailable");
  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: true,
    sourceReadiness: { status: "ready" },
    sourceHealthError: "postgres_source_health_query_failed",
  }, env), "source_health_unavailable");
});

test("service API readiness guard is inactive outside postgres-only service mode", () => {
  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: true,
    sourceReadiness: { status: "not_ready" },
  }, { SERVICE_REQUIRE_POSTGRES: "false" }), null);
  assert.equal(serviceApiReadinessBlockReason({
    postgresConfigured: false,
    sourceReadiness: { status: "not_ready" },
  }, { SERVICE_REQUIRE_POSTGRES: "true" }), null);
});
