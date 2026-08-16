import assert from "node:assert/strict";
import test from "node:test";

import {
  isRevalidateRequestAuthorized,
  revalidateRequestSecret,
  secretValueFailure,
} from "../lib/revalidate-auth.ts";

test("revalidation auth accepts bearer or header secrets only", () => {
  const env = { VERCEL_REVALIDATE_SECRET: "revalidate-prod-secret-123" };

  assert.equal(isRevalidateRequestAuthorized(new Request("https://skyplanner.test/api/revalidate", {
    method: "POST",
    headers: { "x-revalidate-secret": "revalidate-prod-secret-123" },
  }), env), true);
  assert.equal(isRevalidateRequestAuthorized(new Request("https://skyplanner.test/api/revalidate", {
    method: "POST",
    headers: { authorization: "Bearer revalidate-prod-secret-123" },
  }), env), true);
  assert.equal(isRevalidateRequestAuthorized(new Request("https://skyplanner.test/api/revalidate?secret=revalidate-prod-secret-123", {
    method: "POST",
  }), env), false);
});

test("revalidation auth rejects missing and placeholder configured secrets", () => {
  assert.equal(secretValueFailure(undefined), "missing");
  assert.equal(secretValueFailure("test-secret"), "placeholder_value");
  assert.equal(secretValueFailure("short-secret"), "too_short");
  assert.equal(isRevalidateRequestAuthorized(new Request("https://skyplanner.test/api/revalidate", {
    method: "POST",
    headers: { "x-revalidate-secret": "test-secret" },
  }), { VERCEL_REVALIDATE_SECRET: "test-secret" }), false);
  assert.equal(isRevalidateRequestAuthorized(new Request("https://skyplanner.test/api/revalidate", {
    method: "POST",
    headers: { "x-revalidate-secret": "short-secret" },
  }), { VERCEL_REVALIDATE_SECRET: "short-secret" }), false);
});

test("revalidation request secret parser ignores query strings", () => {
  assert.equal(revalidateRequestSecret(new Request("https://skyplanner.test/api/revalidate?secret=leaky", {
    method: "POST",
  })), "");
});
