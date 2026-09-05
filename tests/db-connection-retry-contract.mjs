import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableConnectionError, withConnectionRetry } from "../lib/db.ts";
import { sanitizedPostgresFailure } from "../lib/read-model/diagnostics.ts";

// INT-20260906-001/002: Neon autosuspend 콜드스타트 1회 재시도 + fallback_reason 연결/쿼리 분류.
// 2026-09-06 실측: 유휴 11분 뒤 첫 /api/ops/source-health가 연결 실패로 503, 재시도는 즉시 200.

function pgError(code, message = `pg error ${code}`) {
  return Object.assign(new Error(message), { code });
}

test("connection-class errors are retryable, query-class errors are not", () => {
  for (const code of ["CONNECTION_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EPIPE"]) {
    assert.equal(isRetryableConnectionError(pgError(code)), true, code);
  }
  assert.equal(isRetryableConnectionError(pgError("42P01", 'relation "x" does not exist')), false);
  assert.equal(isRetryableConnectionError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isRetryableConnectionError(pgError("28P01", "password authentication failed")), false);
  assert.equal(isRetryableConnectionError(null), false);
  assert.equal(isRetryableConnectionError("timeout"), false);
});

test("withConnectionRetry retries exactly once and only for connection errors", async () => {
  let calls = 0;
  const result = await withConnectionRetry(async () => {
    calls += 1;
    return calls === 1 ? Promise.reject(pgError("CONNECTION_TIMEOUT")) : Promise.resolve("recovered");
  });
  assert.equal(result, "recovered");
  assert.equal(calls, 2, "재시도 가능 오류는 정확히 1회만 재실행");

  let nonRetryableCalls = 0;
  await assert.rejects(
    withConnectionRetry(async () => {
      nonRetryableCalls += 1;
      throw pgError("42P01");
    }),
    /pg error 42P01/,
  );
  assert.equal(nonRetryableCalls, 1, "쿼리 계열 오류는 재시도하지 않는다");

  let exhaustedCalls = 0;
  await assert.rejects(
    withConnectionRetry(async () => {
      exhaustedCalls += 1;
      throw pgError("ETIMEDOUT");
    }),
    /ETIMEDOUT/,
  );
  assert.equal(exhaustedCalls, 2, "재시도까지 실패하면 원본 오류를 그대로 전파");
});

test("sanitized postgres failure distinguishes connection from query failures", () => {
  assert.equal(sanitizedPostgresFailure(pgError("CONNECTION_TIMEOUT")), "postgres_connection_failed");
  assert.equal(sanitizedPostgresFailure(new Error("Connection terminated unexpectedly")), "postgres_connection_failed");
  assert.equal(sanitizedPostgresFailure(pgError("42P01")), "postgres_query_failed");
  assert.equal(sanitizedPostgresFailure(new Error("boom")), "postgres_query_failed");
});
