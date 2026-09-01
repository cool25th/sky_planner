import assert from "node:assert/strict";
import test from "node:test";

import { MIN_PRODUCTION_SECRET_LENGTH, secretValueFailure } from "../lib/secret-validation.ts";

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
