import assert from "node:assert/strict";
import test from "node:test";

import { errorMessage } from "../lib/error-message.ts";

test("error message normalizes empty Error messages to a fallback code", () => {
  assert.equal(errorMessage(new Error(""), "postgres_connection_failed"), "postgres_connection_failed");
  assert.equal(errorMessage(new AggregateError([], ""), "postgres_connection_failed"), "postgres_connection_failed");
  assert.equal(errorMessage(new Error("connection refused"), "postgres_connection_failed"), "connection refused");
});
