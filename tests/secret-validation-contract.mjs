import assert from "node:assert/strict";
import test from "node:test";

import { MIN_PRODUCTION_SECRET_LENGTH, secretMatches, secretValueFailure } from "../lib/secret-validation.ts";

// TEST-20260822-003: 신뢰 경계(placeholder 거부·길이·누락) 규칙의 허용/거부 케이스 표.

test("secretValueFailure rejects missing values", () => {
  assert.equal(secretValueFailure(undefined), "missing");
  assert.equal(secretValueFailure(""), "missing");
  assert.equal(secretValueFailure("   "), "missing");
});

test("secretValueFailure rejects placeholders case-insensitively", () => {
  for (const value of ["secret", "SECRET", "Your-Secret-Here", "replace-me", "prefix-replace-me-suffix", "test-token", "changeme"]) {
    assert.equal(secretValueFailure(value), "placeholder_value", value);
  }
});

test("secretValueFailure enforces minimum length with default 16", () => {
  assert.equal(MIN_PRODUCTION_SECRET_LENGTH, 16);
  assert.equal(secretValueFailure("a".repeat(15)), "too_short");
  assert.equal(secretValueFailure("a".repeat(16)), null);
  assert.equal(secretValueFailure("a".repeat(3), { minLength: 0 }), null, "minLength:0 disables the length rule");
});

// SEC-20260903-001: 요청 시크릿 비교는 길이가 달라도 예외 없이 거짓을 반환해야 한다(timing-safe).
test("secretMatches compares secrets without throwing on length mismatch", () => {
  assert.equal(secretMatches("revalidate-prod-secret-123", "revalidate-prod-secret-123"), true);
  assert.equal(secretMatches("revalidate-prod-secret-123", "revalidate-prod-secret-124"), false);
  assert.equal(secretMatches("", "revalidate-prod-secret-123"), false, "빈 제출값");
  assert.equal(secretMatches("revalidate-prod-secret-123", ""), false, "빈 설정값");
  assert.equal(secretMatches("short", "a-much-longer-configured-secret-value"), false, "길이 차이");
});
