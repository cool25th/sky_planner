import assert from "node:assert/strict";
import test from "node:test";

import { apiHeadersForResponse, apiStatusForResponse } from "../lib/api-response-policy.ts";
import {
  serviceRequirePostgresFailure,
  serviceRequiresPostgres,
} from "../lib/service-mode.ts";

test("service mode requires an explicit postgres-only runtime flag", () => {
  assert.equal(serviceRequiresPostgres({ SERVICE_REQUIRE_POSTGRES: "true" }), true);
  assert.equal(serviceRequiresPostgres({ SERVICE_REQUIRE_POSTGRES: "required" }), true);
  assert.equal(serviceRequiresPostgres({ SERVICE_REQUIRE_POSTGRES: "false" }), false);
  assert.equal(serviceRequirePostgresFailure({}), "missing");
  assert.equal(serviceRequirePostgresFailure({ SERVICE_REQUIRE_POSTGRES: "false" }), "disabled");
  assert.equal(serviceRequirePostgresFailure({ SERVICE_REQUIRE_POSTGRES: "maybe" }), "invalid");
  assert.equal(serviceRequirePostgresFailure({ SERVICE_REQUIRE_POSTGRES: "true" }), null);
});

test("API responses become 503 when service read model fallback is suppressed", () => {
  const response = {
    request_id: "test",
    generated_at: "2026-05-29T00:00",
    last_batch_at: "2026-05-29T00:00",
    warning_flags: ["service_read_model_unavailable"],
    source_flags: [],
    diagnostics: {
      service_unavailable: true,
      fallback_suppressed: true,
    },
    data: {},
  };

  assert.equal(apiStatusForResponse(response), 503);
  assert.equal(apiHeadersForResponse(response)?.["Cache-Control"], "no-store");
  assert.equal(apiStatusForResponse({ ...response, diagnostics: { service_unavailable: false } }), 200);
});

test("API status policy blocks source readiness failures defensively", () => {
  const response = {
    request_id: "test",
    generated_at: "2026-05-29T00:00",
    last_batch_at: "2026-05-29T00:00",
    warning_flags: [],
    source_flags: ["skyscanner_affiliate"],
    diagnostics: {
      service_requires_postgres: true,
      service_unavailable: false,
      source_readiness: {
        status: "not_ready",
      },
    },
    data: {},
  };

  assert.equal(apiStatusForResponse(response), 503);
  assert.equal(apiHeadersForResponse(response)?.["Cache-Control"], "no-store");
  assert.equal(apiStatusForResponse({
    ...response,
    diagnostics: {
      service_requires_postgres: true,
      source_readiness: {
        status: "ready",
      },
    },
  }), 200);
});
