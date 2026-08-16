import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  policyArtifactSnapshot,
  userExperienceArtifactSnapshot,
} from "../lib/readiness-artifacts.ts";

test("readiness artifact snapshot verifies public policy and outage UI surfaces", async () => {
  const [policy, ux] = await Promise.all([
    policyArtifactSnapshot(),
    userExperienceArtifactSnapshot(),
  ]);

  assert.deepEqual(policy, {
    publicPolicyPage: true,
    affiliateDisclosure: true,
    dataAccuracyDisclosure: true,
    supportContactDisclosure: true,
    opsRunbook: true,
    readinessApi: true,
    readinessPage: true,
  });
  assert.deepEqual(ux, {
    trustCues: true,
    serviceUnavailableUi: true,
  });
});

test("service readiness page labels all service gate checks added for launch operations", () => {
  const source = readFileSync("app/service-readiness/page.tsx", "utf-8");
  const readinessSource = readFileSync("lib/service-readiness.ts", "utf-8");
  const checkNames = [...new Set([...readinessSource.matchAll(/check\("([a-z0-9_]+)"/g)]
    .map((match) => match[1]))].sort();
  const missingLabels = checkNames.filter((checkName) => !source.includes(`${checkName}:`));

  assert.deepEqual(missingLabels, []);

  for (const token of [
    "예약 링크 샘플 깊이",
    "production build gate",
    "collector artifact 보존",
    "item.priority",
    "item.phase",
    "short_source_count",
    "minimum_per_source",
  ]) {
    assert.match(source, new RegExp(token));
  }
});

test("service readiness runtime uses deployment env for source health scope", () => {
  const source = readFileSync("lib/service-readiness-runtime.ts", "utf-8");

  assert.match(source, /buildSourceReadinessSnapshot\(\{\s*healthRows:[\s\S]*batchState:[\s\S]*env,/);
  assert.doesNotMatch(source, /enabledSourceFlagsFromEnv/);
});

test("runtime and CLI readiness artifacts require dynamic public fare APIs", () => {
  for (const path of [
    "lib/service-readiness-runtime.ts",
    "scripts/service-readiness-smoke.mjs",
  ]) {
    const source = readFileSync(path, "utf-8");

    for (const routePath of [
      "app/api/search/route.ts",
      "app/api/deals/map/route.ts",
      "app/api/deals/calendar/route.ts",
      "app/api/offers/route.ts",
    ]) {
      const pattern = new RegExp(`artifactContains\\("${routePath.replaceAll("/", "\\/")}", \\["dynamic = \\\\"force-dynamic\\\\""`);
      assert.match(source, pattern);
    }
  }
});

test("runtime and CLI readiness artifacts require launch evidence checklist", () => {
  for (const path of [
    "lib/service-readiness-runtime.ts",
    "scripts/service-readiness-smoke.mjs",
  ]) {
    const source = readFileSync(path, "utf-8");

    assert.match(source, /buildServiceLaunchEvidenceChecklist/);
    assert.match(source, /evidence_checklist/);
    assert.match(source, /evidence_checklist_status/);
    assert.match(source, /evidence_checklist_not_present/);
    assert.match(source, /evidence_report_path/);
    assert.match(source, /retention-days: 30/);
    assert.match(source, /retention-days: 90/);
    assert.match(source, /buildServiceReadinessCliOutput/);
    assert.match(source, /enrichInternalServiceReadinessSnapshot/);
    assert.match(source, /operator_actions/);
    assert.match(source, /sanitizeOperatorActions/);
    assert.match(source, /remediationFromOperatorAction/);
  }
});

test("collector workflow retains launch evidence long enough for service audits", () => {
  const source = readFileSync(".github/workflows/collect-fares.yml", "utf-8");

  assert.match(source, /name: collector-artifacts[\s\S]*retention-days: 30/);
  assert.match(source, /name: service-launch-audit[\s\S]*retention-days: 90/);
});
