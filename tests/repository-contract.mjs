import test from "node:test";
import assert from "node:assert/strict";

import { MockRepository } from "../lib/data/mock-repository.ts";
import { calculateEstimatedWrites, validateWriteQuota, QUOTA_LIMITS } from "../lib/quota/guard.ts";

test("MockRepository satisfies FlightDataRepository contract", async () => {
  const repo = new MockRepository();
  const state = await repo.getServiceState();
  assert.equal(state.data_status, "ready");
  assert.equal(state.mock_data_enabled, true);

  const deals = await repo.getMapDeals({
    origin: "ICN",
    week: "2026-W13",
    region: "ALL",
    cabin: "ALL",
    stay_bucket: "5_7",
    traveler: "adt1",
  });
  assert.ok(Array.isArray(deals));
  assert.ok(deals.length > 0);

  const health = await repo.getSourceHealth();
  assert.equal(health.status, "ready");
  assert.ok(health.source_flags.length >= 2);
});

test("Quota Guard enforces Spark plan write budget limits", () => {
  // Normal batch (well within 12,000 writes)
  const normalBudget = calculateEstimatedWrites({
    sourceCount: 2,
    viewCount: 288,
    offerCount: 1200,
  });
  assert.ok(normalBudget.total_writes < QUOTA_LIMITS.MAX_DAILY_WRITES);
  const normalCheck = validateWriteQuota(normalBudget);
  assert.equal(normalCheck.ok, true);

  // Massive batch exceeding 12,000 writes -> must block
  const excessBudget = calculateEstimatedWrites({
    sourceCount: 10,
    viewCount: 1000,
    offerCount: 15000,
  });
  const excessCheck = validateWriteQuota(excessBudget);
  assert.equal(excessCheck.ok, false);
  assert.match(excessCheck.reason, /exceed Spark plan daily limit/);
});
