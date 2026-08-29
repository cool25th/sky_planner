import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildServiceLaunchActionPlan,
  buildServiceLaunchDecision,
  buildServiceLaunchEnvChecklist,
  buildServiceLaunchEvidenceChecklist,
  buildServiceLaunchPlan,
  loadAuditEnvOverrides,
  parseEnvFile,
  parseServiceLaunchJsonSummary,
  redactSensitiveOutput,
  redactSensitiveReportValue,
  runServiceLaunchAudit,
  serviceLaunchAuditExitCode,
  writeServiceLaunchReport,
} from "../scripts/service-launch-audit.mjs";

async function passingCollectorAuditReport() {
  return runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") {
          return {
            sent: true,
            status: 204,
            validation: { ok: true },
          };
        }
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        if (step.id === "runtime_env_preflight" || step.id === "service_env_preflight") {
          return {
            status: "pass",
            failed_checks: [],
          };
        }
        return {
          status: "ready",
          failed_checks: [],
        };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
}

test("service launch audit plan runs non-mutating gates by default", () => {
  const plan = buildServiceLaunchPlan();

  assert.equal(plan.manifest_env, "COLLECTOR_SOURCE_MANIFEST_JSON");
  assert.equal(plan.run_collector, false);
  assert.equal(plan.verify_release_gates, false);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
    "production_readiness",
    "service_readiness",
  ]);
  assert.equal(plan.steps.some((step) => step.mutates_database), false);
  assert.deepEqual(plan.steps.find((step) => step.id === "runtime_env_preflight").required_env, [
    "DATABASE_URL",
    "OPS_ALERT_WEBHOOK_URL",
    "SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_EMAIL",
    "OPS_READINESS_TOKEN",
    "SERVICE_REQUIRE_POSTGRES",
    "VERCEL_REVALIDATE_SECRET",
    "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED",
    "SOURCE_MAX_STALE_HOURS",
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === "production_readiness").required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "VERCEL_REVALIDATE_SECRET",
    "source token_env secrets referenced by manifest",
    "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED",
    "SOURCE_MAX_STALE_HOURS",
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === "service_readiness").command, [
    "npm",
    "run",
    "smoke:service-readiness",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "--notify",
  ]);
});

test("service launch audit plan can include release gates in the evidence flow", () => {
  const plan = buildServiceLaunchPlan({
    runCollector: true,
    verifyReleaseGates: true,
  });
  const collectorStep = plan.steps.find((step) => step.id === "collect_approved_sources");

  assert.equal(plan.verify_release_gates, true);
  assert.deepEqual(plan.steps.map((step) => step.id).slice(0, 3), [
    "js_contract_tests",
    "python_backend_tests",
    "production_build",
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === "js_contract_tests").command, ["npm", "test"]);
  assert.deepEqual(plan.steps.find((step) => step.id === "python_backend_tests").command, [
    "python3",
    "-m",
    "unittest",
    "discover",
    "-s",
    "tests",
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === "production_build").command, ["npm", "run", "build"]);
  assert.equal(plan.steps.find((step) => step.id === "production_build").release_gate, true);
  assert.deepEqual(collectorStep.requires_pass, [
    "js_contract_tests",
    "python_backend_tests",
    "production_build",
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
  ]);
});

test("service launch audit dry-run checklist expands env requirements without values", () => {
  const manifest = {
    schema_version: "collector.source_manifest.v1",
    sources: [
      {
        config: {
          source_id: "skyscanner_affiliate",
          auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
        },
      },
    ],
  };
  const envOverrides = {
    COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify(manifest),
    DATABASE_URL: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
    SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
  };
  const plan = buildServiceLaunchPlan({
    databaseUrl: envOverrides.DATABASE_URL,
    runCollector: true,
  });
  const checklist = buildServiceLaunchEnvChecklist(plan, { envOverrides });
  const byId = Object.fromEntries(checklist.map((item) => [item.id, item]));
  const payload = JSON.stringify(checklist);

  assert.deepEqual(byId.source_token_env_secrets.env_names, ["SKYSCANNER_PARTNER_TOKEN"]);
  assert.equal(byId.source_token_env_secrets.provided_in_rehearsal, true);
  assert.equal(byId.DATABASE_URL.provided_in_rehearsal, true);
  assert.ok(byId.DATABASE_URL.required_by_steps.includes("runtime_env_preflight"));
  assert.ok(byId.COLLECTOR_SOURCE_MANIFEST_JSON.required_by_steps.includes("service_env_preflight"));
  assert.ok(byId.source_token_env_secrets.verify_commands.some((command) => command.includes("collector:sources")));
  assert.doesNotMatch(payload, /skyscanner-live-secret-123/);
  assert.doesNotMatch(payload, /sky_planner:secret/);
});

test("service launch audit checklist expands config path manifest token env names", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-launch-config-path-"));
  try {
    await writeFile(path.join(tmpRoot, "source.json"), `${JSON.stringify({
      schema_version: "collector.authorized_feed_source.v1",
      source_id: "skyscanner_affiliate",
      source_type: "meta_search",
      endpoint: "https://partner.example-prod.com/fares",
      auth: { header_name: "Authorization", token_env: "SKYSCANNER_PARTNER_TOKEN" },
    }, null, 2)}\n`);
    const manifest = {
      schema_version: "collector.source_manifest.v1",
      sources: [
        { config_path: "source.json" },
        { enabled: false, config_path: "disabled-source.json" },
      ],
    };
    const envOverrides = {
      COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify(manifest),
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
    };
    const plan = buildServiceLaunchPlan({ runCollector: true });
    const checklist = buildServiceLaunchEnvChecklist(plan, { envOverrides, baseDir: tmpRoot });
    const sourceSecrets = checklist.find((item) => item.id === "source_token_env_secrets");
    const payload = JSON.stringify(checklist);

    assert.deepEqual(sourceSecrets.env_names, ["SKYSCANNER_PARTNER_TOKEN"]);
    assert.equal(sourceSecrets.provided_in_rehearsal, true);
    assert.doesNotMatch(payload, /skyscanner-live-secret-123/);
    assert.doesNotMatch(payload, /disabled-source/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("service launch audit evidence checklist separates non-env launch proof", () => {
  const plan = buildServiceLaunchPlan({
    runCollector: true,
    verifyReleaseGates: true,
  });
  const checklist = buildServiceLaunchEvidenceChecklist(plan);
  const byId = Object.fromEntries(checklist.map((item) => [item.id, item]));
  const payload = JSON.stringify(checklist);

  assert.equal(byId.release_gate_evidence.status, "planned");
  assert.equal(byId.collector_cutover_evidence.status, "planned");
  assert.equal(byId.collector_history_evidence.status, "planned");
  assert.equal(byId.deeplink_sample_evidence.status, "planned");
  assert.equal(byId.persisted_launch_report.status, "missing");
  assert.deepEqual(byId.collector_history_evidence.required_checks, [
    "live_collector_success",
    "collector_success_rate_7d",
    "last_batch_source_coverage",
  ]);
  assert.ok(byId.deeplink_sample_evidence.required_checks.includes("booking_deeplink_sample_depth"));
  assert.ok(byId.deeplink_sample_evidence.required_checks.includes("booking_deeplink_production_shape"));
  assert.ok(byId.persisted_launch_report.verify_commands[0].includes("--output-dir"));
  assert.doesNotMatch(payload, /skyscanner-live-secret|postgresql:\/\/sky_planner/i);

  const dryRunPlan = buildServiceLaunchPlan({ verifyReleaseGates: true });
  const dryRunChecklist = buildServiceLaunchEvidenceChecklist(dryRunPlan, { mode: "dry-run" });
  const dryRunReportEvidence = dryRunChecklist.find((item) => item.id === "persisted_launch_report");
  assert.ok(dryRunReportEvidence.verify_commands[0].includes("--run-collector"));
  assert.ok(dryRunReportEvidence.verify_commands[0].includes("--verify-release-gates"));
});

test("service launch evidence checklist marks complete cutover proof as present", async () => {
  const report = await passingCollectorAuditReport();
  const checklist = buildServiceLaunchEvidenceChecklist(report.plan, {
    results: report.results,
    reportPath: "runtime/service-launch-audits/service-launch-run-collector-test.json",
  });
  const byId = Object.fromEntries(checklist.map((item) => [item.id, item]));

  assert.equal(byId.release_gate_evidence.status, "present");
  assert.equal(byId.runtime_env_preflight_evidence.status, "present");
  assert.equal(byId.service_env_preflight_evidence.status, "present");
  assert.equal(byId.ops_alert_delivery_evidence.status, "present");
  assert.equal(byId.collector_cutover_evidence.status, "present");
  assert.equal(byId.production_readiness_evidence.status, "present");
  assert.equal(byId.service_readiness_evidence.status, "present");
  assert.equal(byId.collector_history_evidence.status, "present");
  assert.equal(byId.deeplink_sample_evidence.status, "present");
  assert.equal(byId.persisted_launch_report.status, "present");
  assert.equal(byId.persisted_launch_report.report_path, "runtime/service-launch-audits/service-launch-run-collector-test.json");
});

test("service launch decision requires collector cutover audit even when non-mutating gates pass", async () => {
  const report = await runServiceLaunchAudit({
    stepRunner: async (step) => ({
      id: step.id,
      code: 0,
      signal: null,
      status: "pass",
      output: {
        stdout_tail: JSON.stringify({ status: "ready", summary: { failed_checks: [] } }),
        stdout_truncated: false,
        stderr_tail: "",
        stderr_truncated: false,
        json_summary: {
          status: "ready",
          failed_checks: [],
        },
      },
    }),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "cutover_audit_required");
  assert.equal(report.launch_decision.collector_audit_included, false);
  assert.equal(report.action_plan.status, "action_required");
  assert.ok(report.action_plan.items.some((item) => item.check === "collector_audit_missing"));
  assert.ok(report.action_plan.env_checklist.some((item) => item.id === "source_token_env_secrets"));
  assert.ok(report.launch_decision.required_cutover_command.includes("--run-collector"));
  assert.equal(serviceLaunchAuditExitCode(report), 1);
});

test("service launch decision marks a passing collector audit as launch-ready", async () => {
  const report = await passingCollectorAuditReport();
  const persistedReport = {
    ...report,
    report_path: "runtime/service-launch-audits/service-launch-run-collector-test.json",
  };
  const finalAuditArgs = {
    requireEvidenceReport: true,
    requireEvidenceChecklist: true,
    reportPath: persistedReport.report_path,
  };
  persistedReport.action_plan = buildServiceLaunchActionPlan(persistedReport.results, persistedReport.plan, finalAuditArgs);
  persistedReport.evidence_checklist = buildServiceLaunchEvidenceChecklist(persistedReport.plan, {
    ...finalAuditArgs,
    results: persistedReport.results,
  });
  persistedReport.launch_decision = buildServiceLaunchDecision(persistedReport, {
    ...finalAuditArgs,
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "blocked");
  assert.equal(report.launch_decision.collector_audit_included, true);
  assert.equal(report.launch_decision.release_gates_included, true);
  assert.equal(report.launch_decision.release_gates_passed, true);
  assert.equal(report.launch_decision.js_contract_tests_status, "pass");
  assert.equal(report.launch_decision.python_backend_tests_status, "pass");
  assert.equal(report.launch_decision.production_build_status, "pass");
  assert.equal(report.launch_decision.ops_alert_sent, true);
  assert.equal(report.launch_decision.collector_run_status, "success");
  assert.equal(report.launch_decision.collector_sources_succeeded, 3);
  assert.equal(report.launch_decision.collector_sources_failed, 0);
  assert.equal(report.launch_decision.runtime_env_preflight_status, "pass");
  assert.equal(report.launch_decision.service_env_preflight_status, "pass");
  assert.equal(report.launch_decision.production_readiness_status, "ready");
  assert.equal(report.launch_decision.service_readiness_status, "ready");
  assert.ok(report.launch_decision.decision_blockers.includes("evidence_report_missing"));
  assert.ok(report.launch_decision.decision_blockers.includes("evidence_checklist_not_present"));
  assert.equal(report.launch_decision.evidence_checklist_status, "missing");
  assert.deepEqual(report.launch_decision.evidence_checklist_missing_ids, ["persisted_launch_report"]);
  assert.ok(report.launch_decision.required_cutover_command);
  assert.equal(persistedReport.launch_decision.ready_to_launch, true);
  assert.equal(persistedReport.launch_decision.evidence_report_persisted, true);
  assert.equal(persistedReport.launch_decision.evidence_checklist_required, true);
  assert.equal(persistedReport.launch_decision.evidence_checklist_status, "present");
  assert.deepEqual(persistedReport.launch_decision.evidence_checklist_missing_ids, []);
  assert.deepEqual(persistedReport.launch_decision.decision_blockers, []);
  assert.equal(persistedReport.launch_decision.required_cutover_command, null);
  assert.equal(serviceLaunchAuditExitCode(persistedReport), 0);
});

test("service launch decision blocks cutover without release gate evidence", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") return { sent: true, status: 204, validation: { ok: true } };
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        if (step.id === "runtime_env_preflight" || step.id === "service_env_preflight") {
          return { status: "pass", failed_checks: [] };
        }
        return { status: "ready", failed_checks: [] };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const releaseGateItem = report.action_plan.items.find((item) => item.check === "release_gates_missing");

  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.release_gates_included, false);
  assert.equal(report.launch_decision.release_gates_passed, false);
  assert.ok(report.launch_decision.decision_blockers.includes("release_gates_missing"));
  assert.ok(releaseGateItem);
  assert.deepEqual(releaseGateItem.required_env, []);
  assert.ok(releaseGateItem.verify_command.includes("--verify-release-gates"));
  assert.ok(report.launch_decision.required_cutover_command.includes("--verify-release-gates"));
  assert.equal(serviceLaunchAuditExitCode(report), 1);
});

test("service launch action plan maps failed release gate blocker", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    reportPath: "runtime/service-launch-audits/service-launch-run-collector-test.json",
    stepRunner: async (step) => {
      const failed = step.id === "production_build";
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") return { sent: true, status: 204, validation: { ok: true } };
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        return { status: failed ? "fail" : "ready", failed_checks: [] };
      })();
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.equal(report.launch_decision.release_gates_included, true);
  assert.equal(report.launch_decision.release_gates_passed, false);
  assert.equal(report.launch_decision.production_build_status, "fail");
  assert.ok(report.launch_decision.decision_blockers.includes("release_gates_not_pass"));
  assert.ok(itemByCheck.release_gates_not_pass);
  assert.deepEqual(itemByCheck.release_gates_not_pass.seen_in_steps, ["production_build"]);
  assert.deepEqual(itemByCheck.release_gates_not_pass.required_env, []);
  assert.ok(itemByCheck.release_gates_not_pass.verify_command.includes("--verify-release-gates"));
  assert.ok(itemByCheck["step:production_build"]);
  assert.deepEqual(itemByCheck["step:production_build"].verify_command, ["npm", "run", "build"]);
});

test("service launch executable exit requires persisted cutover evidence", async () => {
  const report = await passingCollectorAuditReport();
  const launchDecision = buildServiceLaunchDecision(report, { requireEvidenceReport: true });
  const actionPlan = buildServiceLaunchActionPlan(report.results, report.plan, { requireEvidenceReport: true });
  const missingEvidenceItem = actionPlan.items.find((item) => item.check === "evidence_report_missing");

  assert.equal(launchDecision.ready_to_launch, false);
  assert.equal(launchDecision.decision, "blocked");
  assert.equal(launchDecision.evidence_report_required, true);
  assert.equal(launchDecision.evidence_report_persisted, false);
  assert.equal(launchDecision.evidence_report_path, null);
  assert.equal(launchDecision.evidence_checklist_required, true);
  assert.equal(launchDecision.evidence_checklist_status, "missing");
  assert.deepEqual(launchDecision.evidence_checklist_missing_ids, ["persisted_launch_report"]);
  assert.ok(launchDecision.decision_blockers.includes("evidence_report_missing"));
  assert.ok(launchDecision.decision_blockers.includes("evidence_checklist_not_present"));
  assert.equal(actionPlan.status, "action_required");
  assert.ok(missingEvidenceItem);
  assert.ok(actionPlan.items.find((item) => item.check === "evidence_checklist_not_present"));
  assert.deepEqual(missingEvidenceItem.required_env, []);
  assert.ok(missingEvidenceItem.verify_command.includes("--output-dir"));
  assert.equal(serviceLaunchAuditExitCode({ ...report, launch_decision: launchDecision }), 1);
});

test("service launch audit stdout parser preserves alert delivery evidence", () => {
  const summary = parseServiceLaunchJsonSummary([
    "",
    "> sky-planner-atlas@0.1.0 smoke:ops-alert",
    "> node scripts/ops-alert-smoke.mjs --event collector_ops_alert_smoke",
    "",
    JSON.stringify({
      sent: true,
      status: 204,
      validation: { ok: true },
    }),
    "",
  ].join("\n"));

  assert.equal(summary.sent, true);
  assert.equal(summary.status, 204);
  assert.deepEqual(summary.failed_checks, null);
});

test("service launch audit stdout parser uses the final JSON summary", () => {
  const summary = parseServiceLaunchJsonSummary([
    "collector progress",
    JSON.stringify({ status: "progress", message: "source {skyscanner_affiliate} started" }),
    "collector finished",
    JSON.stringify({
      status: "success",
      run_id: "collector_run_cutover",
      succeeded: 3,
      failed: 0,
      skipped: 0,
    }),
  ].join("\n"));

  assert.equal(summary.status, "success");
  assert.equal(summary.run_id, "collector_run_cutover");
  assert.equal(summary.succeeded, 3);
  assert.equal(summary.failed, 0);
});

test("service launch audit stdout parser preserves structured readiness evidence", () => {
  const summary = parseServiceLaunchJsonSummary(JSON.stringify({
    status: "not_ready",
    generated_at: "2026-05-31T00:00:00.000Z",
    summary: {
      failed_checks: ["booking_deeplink_sample_depth", "collector_success_rate_7d"],
    },
    axes: [
      {
        id: "booking_conversion",
        checks: [
          {
            name: "booking_deeplink_sample_depth",
            status: "fail",
            detail: {
              minimum_per_source: 5,
              short_source_ids: [{ source_id: "skyscanner_affiliate", valid_count: 3 }],
            },
          },
        ],
      },
    ],
    database: {
      deeplink_sample: {
        checked: 20,
        hosts: ["booking.example-prod.com"],
      },
    },
    checks: {
      database: [
        {
          name: "booking_deeplink_production_shape",
          status: "pass",
          detail: { invalid_rate: 0 },
        },
      ],
    },
    operator_actions: [
      {
        check: "booking_deeplink_sample_depth",
        priority: 41,
        phase: "예약 전환",
        axis: "booking_conversion",
        axis_label: "예약 전환 신뢰성",
        status: "fail",
        action: "활성 source마다 고유 예약 deeplink 샘플을 확보합니다.",
        verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
        required_env: ["DATABASE_URL"],
        affected_sources: ["skyscanner_affiliate"],
      },
    ],
  }));

  assert.equal(summary.status, "not_ready");
  assert.deepEqual(summary.failed_checks, ["booking_deeplink_sample_depth", "collector_success_rate_7d"]);
  assert.equal(summary.evidence.generated_at, "2026-05-31T00:00:00.000Z");
  assert.equal(summary.evidence.axes[0].id, "booking_conversion");
  assert.equal(summary.evidence.axes[0].checks[0].detail.minimum_per_source, 5);
  assert.equal(summary.evidence.database.deeplink_sample.checked, 20);
  assert.equal(summary.evidence.checks.database[0].name, "booking_deeplink_production_shape");
  assert.deepEqual(summary.operator_actions, [
    {
      check: "booking_deeplink_sample_depth",
      priority: 41,
      phase: "예약 전환",
      axis: "booking_conversion",
      axis_label: "예약 전환 신뢰성",
      status: "fail",
      action: "활성 source마다 고유 예약 deeplink 샘플을 확보합니다.",
      verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
      required_env: ["DATABASE_URL"],
      affected_sources: ["skyscanner_affiliate"],
    },
  ]);
});

test("service launch decision blocks passing steps without collector success evidence", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => ({
      id: step.id,
      code: 0,
      signal: null,
      status: "pass",
      output: {
        stdout_tail: JSON.stringify({ status: "ready", summary: { failed_checks: [] } }),
        stdout_truncated: false,
        stderr_tail: "",
        stderr_truncated: false,
        json_summary: {
          status: "ready",
          failed_checks: [],
        },
      },
    }),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "blocked");
  assert.equal(report.launch_decision.collector_run_status, "ready");
  assert.equal(report.launch_decision.collector_sources_succeeded, null);
  assert.ok(report.launch_decision.required_cutover_command.includes("--run-collector"));
});

test("service launch action plan surfaces failed collector step decision blocker", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    reportPath: "runtime/service-launch-audits/service-launch-run-collector-test.json",
    stepRunner: async (step) => {
      const failed = step.id === "collect_approved_sources";
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") return { sent: true, status: 204, validation: { ok: true } };
        if (step.id === "runtime_env_preflight" || step.id === "service_env_preflight") {
          return { status: "pass", failed_checks: [] };
        }
        if (step.id === "collect_approved_sources") {
          return {
            status: "failed",
            run_id: "collector_run_cutover",
            succeeded: 0,
            failed: 1,
            skipped: 0,
          };
        }
        return { status: "ready", failed_checks: [] };
      })();
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.ok(report.launch_decision.decision_blockers.includes("collector_step_not_pass"));
  assert.ok(itemByCheck.collector_step_not_pass);
  assert.deepEqual(itemByCheck.collector_step_not_pass.seen_in_steps, ["collect_approved_sources"]);
  assert.deepEqual(itemByCheck.collector_step_not_pass.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "VERCEL_REVALIDATE_SECRET",
    "source token_env secrets referenced by manifest",
  ]);
  assert.ok(itemByCheck.collector_step_not_pass.verify_command.includes("--run-collector"));
  assert.ok(itemByCheck.collector_run_not_success);
  assert.ok(itemByCheck.collector_sources_missing);
  assert.ok(itemByCheck.collector_sources_failed);
  assert.ok(itemByCheck["step:collect_approved_sources"]);
});

test("service launch decision requires runtime and service preflight JSON pass status", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") {
          return {
            sent: true,
            status: 204,
            validation: { ok: true },
          };
        }
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        if (step.id === "runtime_env_preflight" || step.id === "service_env_preflight") {
          return { status: "ready", failed_checks: [] };
        }
        if (step.id === "production_readiness" || step.id === "service_readiness") {
          return { status: "ready", failed_checks: [] };
        }
        return { status: "pass", failed_checks: [] };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.deepEqual(report.launch_decision.runtime_env_preflight_status, "ready");
  assert.deepEqual(report.launch_decision.service_env_preflight_status, "ready");
  assert.ok(report.launch_decision.decision_blockers.includes("runtime_env_preflight_not_pass"));
  assert.ok(report.launch_decision.decision_blockers.includes("service_env_preflight_not_pass"));
  assert.deepEqual(itemByCheck.runtime_env_preflight_not_pass.verify_command, [
    "npm",
    "run",
    "preflight:runtime-env",
    "--",
  ]);
  assert.deepEqual(itemByCheck.service_env_preflight_not_pass.verify_command, [
    "npm",
    "run",
    "preflight:service-env",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
});

test("service launch action plan maps failed gate steps without JSON checks to named blockers", async () => {
  const failedGateIds = new Set([
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
    "production_readiness",
    "service_readiness",
  ]);
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => ({
      id: step.id,
      code: failedGateIds.has(step.id) ? 1 : 0,
      signal: null,
      status: failedGateIds.has(step.id) ? "fail" : "pass",
    }),
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.ok(report.launch_decision.decision_blockers.includes("runtime_env_preflight_not_pass"));
  assert.ok(report.launch_decision.decision_blockers.includes("service_env_preflight_not_pass"));
  assert.ok(report.launch_decision.decision_blockers.includes("ops_alert_not_sent"));
  assert.ok(report.launch_decision.decision_blockers.includes("production_readiness_not_ready"));
  assert.ok(report.launch_decision.decision_blockers.includes("service_readiness_not_ready"));
  assert.deepEqual(itemByCheck.runtime_env_preflight_not_pass.verify_command, [
    "npm",
    "run",
    "preflight:runtime-env",
    "--",
  ]);
  assert.deepEqual(itemByCheck.service_env_preflight_not_pass.verify_command, [
    "npm",
    "run",
    "preflight:service-env",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
  assert.deepEqual(itemByCheck.ops_alert_not_sent.verify_command, [
    "npm",
    "run",
    "smoke:ops-alert",
    "--",
    "--event",
    "collector_ops_alert_smoke",
  ]);
  assert.deepEqual(itemByCheck.production_readiness_not_ready.verify_command, [
    "npm",
    "run",
    "smoke:prod-readiness",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
  assert.deepEqual(itemByCheck.service_readiness_not_ready.verify_command, [
    "npm",
    "run",
    "smoke:service-readiness",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "--notify",
  ]);
  assert.ok(itemByCheck["step:runtime_env_preflight"]);
  assert.ok(itemByCheck["step:ops_alert_delivery"]);
  assert.ok(itemByCheck["step:production_readiness"]);
});

test("service launch decision blocks when alert smoke did not send", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") {
          return {
            sent: false,
            status: 500,
            validation: { ok: true },
          };
        }
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        return {
          status: "ready",
          failed_checks: [],
        };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "blocked");
  assert.equal(report.launch_decision.ops_alert_step_status, "pass");
  assert.equal(report.launch_decision.ops_alert_sent, false);
  assert.ok(report.launch_decision.decision_blockers.includes("ops_alert_not_sent"));
  assert.ok(report.launch_decision.required_cutover_command.includes("--run-collector"));
});

test("service launch decision blocks when production readiness JSON is not ready", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") {
          return {
            sent: true,
            status: 204,
            validation: { ok: true },
          };
        }
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        return {
          status: step.id === "production_readiness" ? "not_ready" : "ready",
          failed_checks: step.id === "production_readiness" ? ["source_auth_secret_present"] : [],
        };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "blocked");
  assert.equal(report.launch_decision.production_readiness_status, "not_ready");
  assert.ok(report.launch_decision.decision_blockers.includes("production_readiness_not_ready"));
  assert.ok(report.launch_decision.required_cutover_command.includes("--run-collector"));
});

test("service launch decision blocks when service readiness JSON is not ready", async () => {
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") {
          return {
            sent: true,
            status: 204,
            validation: { ok: true },
          };
        }
        if (step.id === "collect_approved_sources") {
          return {
          status: "success",
          run_id: "collector_run_cutover",
          succeeded: 3,
          failed: 0,
          skipped: 0,
          };
        }
        return {
          status: step.id === "service_readiness" ? "not_ready" : "ready",
          failed_checks: [],
        };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });

  assert.equal(report.status, "pass");
  assert.equal(report.launch_decision.ready_to_launch, false);
  assert.equal(report.launch_decision.decision, "blocked");
  assert.equal(report.launch_decision.collector_run_status, "success");
  assert.equal(report.launch_decision.service_readiness_status, "not_ready");
  assert.ok(report.launch_decision.decision_blockers.includes("service_readiness_not_ready"));
  assert.ok(report.launch_decision.required_cutover_command.includes("--run-collector"));
});

test("service launch decision keeps dry-run distinct from launch readiness", () => {
  const plan = buildServiceLaunchPlan({ databaseUrl: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner" });
  const decision = buildServiceLaunchDecision({
    mode: "dry-run",
    ...plan,
  }, {
    databaseUrl: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
  });
  const payload = JSON.stringify(decision);

  assert.equal(decision.ready_to_launch, false);
  assert.equal(decision.decision, "dry_run_only");
  assert.deepEqual(decision.failed_steps, []);
  assert.ok(decision.required_cutover_command.includes("--run-collector"));
  assert.doesNotMatch(payload, /sky_planner:secret/);
  assert.equal(serviceLaunchAuditExitCode({ mode: "dry-run", launch_decision: decision }), 0);
});

test("service launch audit plan includes collector write when explicitly requested", () => {
  const plan = buildServiceLaunchPlan({
    manifestEnv: "PROD_SOURCE_MANIFEST_JSON",
    runCollector: true,
  });
  const collectorStep = plan.steps.find((step) => step.id === "collect_approved_sources");

  assert.equal(plan.manifest_env, "PROD_SOURCE_MANIFEST_JSON");
  assert.equal(plan.run_collector, true);
  assert.equal(collectorStep.mutates_database, true);
  assert.deepEqual(collectorStep.required_env, [
    "DATABASE_URL",
    "PROD_SOURCE_MANIFEST_JSON",
    "VERCEL_REVALIDATE_SECRET",
    "source token_env secrets referenced by manifest",
  ]);
  assert.deepEqual(collectorStep.requires_pass, [
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
  ]);
  assert.deepEqual(collectorStep.command, [
    "npm",
    "run",
    "collector:sources",
    "--",
    "--manifest-env",
    "PROD_SOURCE_MANIFEST_JSON",
    "--ingest",
    "--audit-failure",
    "--allow-partial",
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === "service_readiness").command, [
    "npm",
    "run",
    "smoke:service-readiness",
    "--",
    "--manifest-env",
    "PROD_SOURCE_MANIFEST_JSON",
    "--notify",
  ]);
});

test("service launch audit redacts database URL command args while preserving runner args", () => {
  const plan = buildServiceLaunchPlan({
    databaseUrl: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
    runCollector: true,
  });
  const collectorStep = plan.steps.find((step) => step.id === "collect_approved_sources");
  const prodStep = plan.steps.find((step) => step.id === "production_readiness");
  const serviceStep = plan.steps.find((step) => step.id === "service_readiness");
  const payload = JSON.stringify(plan);

  assert.doesNotMatch(payload, /sky_planner:secret/);
  assert.deepEqual(collectorStep.command.slice(-2), ["--database-url", "[REDACTED_DATABASE_URL]"]);
  assert.deepEqual(prodStep.command.slice(-2), ["--database-url", "[REDACTED_DATABASE_URL]"]);
  assert.deepEqual(serviceStep.command.slice(-2), ["--database-url", "[REDACTED_DATABASE_URL]"]);
  assert.deepEqual(collectorStep.run_command.slice(0, 3), [process.execPath, "--experimental-strip-types", "scripts/run-collector-sources.mjs"]);
  assert.deepEqual(prodStep.run_command.slice(0, 3), [process.execPath, "--experimental-strip-types", "scripts/prod-readiness-smoke.mjs"]);
  assert.deepEqual(serviceStep.run_command.slice(0, 3), [process.execPath, "--experimental-strip-types", "scripts/service-readiness-smoke.mjs"]);
  assert.equal(collectorStep.run_command.includes("npm"), false);
  assert.equal(prodStep.run_command.includes("npm"), false);
  assert.equal(serviceStep.run_command.includes("npm"), false);
  assert.ok(collectorStep.run_command.includes("postgresql://sky_planner:secret@db.example-prod.com/sky_planner"));
  assert.ok(prodStep.run_command.includes("postgresql://sky_planner:secret@db.example-prod.com/sky_planner"));
  assert.ok(serviceStep.run_command.includes("postgresql://sky_planner:secret@db.example-prod.com/sky_planner"));
});

test("service launch audit can persist a cutover evidence report", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-launch-audit-"));
  try {
    const plan = buildServiceLaunchPlan();
    const outputPath = path.join(tmpRoot, "launch-evidence.json");
    const reportPath = await writeServiceLaunchReport({
      generated_at: "2026-05-29T00:00:00.000Z",
      mode: "dry-run",
      plan,
    }, {
      outputPath,
    });
    const saved = JSON.parse(await readFile(reportPath, "utf-8"));

    assert.equal(reportPath, outputPath);
    assert.equal(saved.generated_at, "2026-05-29T00:00:00.000Z");
    assert.equal(saved.mode, "dry-run");
    assert.equal(saved.plan.manifest_env, "COLLECTOR_SOURCE_MANIFEST_JSON");
    assert.deepEqual(saved.plan.steps.find((step) => step.id === "service_readiness").required_env, [
      "DATABASE_URL",
      "COLLECTOR_SOURCE_MANIFEST_JSON",
      "OPS_ALERT_WEBHOOK_URL",
      "SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_EMAIL",
      "OPS_READINESS_TOKEN",
      "SERVICE_REQUIRE_POSTGRES",
      "source token_env secrets referenced by manifest",
      "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED",
      "SOURCE_MAX_STALE_HOURS",
    ]);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("service launch audit can load rehearsal env overrides without persisting values", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-launch-env-"));
  try {
    const envPath = path.join(tmpRoot, "service.env");
    await writeFile(envPath, [
      "# cutover rehearsal",
      "export OPS_READINESS_TOKEN='ops-readiness-secret-123'",
      "SERVICE_REQUIRE_POSTGRES=true",
      "COLLECTOR_SOURCE_MANIFEST_JSON='{\"schema_version\":\"collector.source_manifest.v1\",\"sources\":[]}'",
      "DATABASE_URL=postgresql://from-file.example-prod.com/sky_planner",
      "",
    ].join("\n"));
    const overrides = await loadAuditEnvOverrides({
      envFile: envPath,
      databaseUrl: "postgresql://cli.example-prod.com/sky_planner",
    });
    const report = await runServiceLaunchAudit({
      envFile: envPath,
      databaseUrl: "postgresql://cli.example-prod.com/sky_planner",
      envOverrides: overrides,
      stepRunner: async (step) => ({
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
      }),
    });
    const payload = JSON.stringify(report);

    assert.equal(overrides.DATABASE_URL, "postgresql://cli.example-prod.com/sky_planner");
    assert.equal(overrides.OPS_READINESS_TOKEN, "ops-readiness-secret-123");
    assert.deepEqual(report.env_input, {
      env_file_provided: true,
      database_url_provided: true,
      provided_env_names: [
        "COLLECTOR_SOURCE_MANIFEST_JSON",
        "DATABASE_URL",
        "OPS_READINESS_TOKEN",
        "SERVICE_REQUIRE_POSTGRES",
      ],
    });
    assert.deepEqual(report.action_plan.rerun_command, [
      "npm",
      "run",
      "audit:service-launch",
      "--",
      "--manifest-env",
      "COLLECTOR_SOURCE_MANIFEST_JSON",
      "--continue-on-failure",
      "--env-file",
      "[REDACTED_ENV_FILE]",
      "--database-url",
      "[REDACTED_DATABASE_URL]",
      "--output-dir",
      "runtime/service-launch-audits",
    ]);
    assert.doesNotMatch(payload, /ops-readiness-secret-123/);
    assert.doesNotMatch(payload, /cli\.example-prod\.com/);
    assert.doesNotMatch(payload, /\\"schema_version\\":\\"collector\.source_manifest\.v1\\"/);
    assert.doesNotMatch(payload, /\\"sources\\":\[\]/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("service launch audit redacts rehearsal secrets from logs and persisted reports", async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sky-planner-launch-redaction-"));
  const redactionEnv = {
    DATABASE_URL: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
    OPS_READINESS_TOKEN: "ops-readiness-secret-123",
    OPS_ALERT_WEBHOOK_URL: "https://hooks.skyplanner.co.kr/service/secret-path",
  };
  try {
    const outputPath = path.join(tmpRoot, "launch-evidence.json");
    const rawLog = [
      "db=postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
      "auth=Bearer live-secret-token-12345",
      "Authorization: Basic basic-header-secret-12345",
      "x-revalidate-secret: revalidate-header-secret-12345",
      "x-api-key: partner-header-secret-12345",
      "webhook=https://hooks.skyplanner.co.kr/service/secret-path",
      "callback=https://skyplanner.co.kr/api/revalidate?secret=ops-readiness-secret-123",
      "{\"secret\":\"inline-json-secret-123\",\"token_env\":\"SKYSCANNER_PARTNER_TOKEN\"}",
      "OPS_READINESS_TOKEN=ops-readiness-secret-123",
    ].join("\n");
    const reportValue = redactSensitiveReportValue({
      env_input: {
        provided_env_names: ["DATABASE_URL", "OPS_READINESS_TOKEN", "OPS_ALERT_WEBHOOK_URL"],
      },
      output: {
        stdout_tail: rawLog,
        json_summary: {
          token: "summary-token-secret-123",
          token_env: "SKYSCANNER_PARTNER_TOKEN",
          nested: {
            database_url: "postgresql://sky_planner:secret@db.example-prod.com/sky_planner",
          },
        },
      },
    }, redactionEnv);

    await writeServiceLaunchReport({
      generated_at: "2026-05-29T00:00:00.000Z",
      results: [{
        id: "runtime_env_preflight",
        output: { stdout_tail: rawLog },
      }],
    }, {
      outputPath,
      redactionEnv,
    });
    const saved = await readFile(outputPath, "utf-8");
    const redactedLog = redactSensitiveOutput(rawLog, redactionEnv);
    const serializedValue = JSON.stringify(reportValue);

    assert.doesNotMatch(redactedLog, /sky_planner:secret/);
    assert.doesNotMatch(redactedLog, /ops-readiness-secret-123/);
    assert.doesNotMatch(redactedLog, /secret-path/);
    assert.doesNotMatch(redactedLog, /live-secret-token-12345/);
    assert.doesNotMatch(redactedLog, /basic-header-secret-12345/);
    assert.doesNotMatch(redactedLog, /revalidate-header-secret-12345/);
    assert.doesNotMatch(redactedLog, /partner-header-secret-12345/);
    assert.doesNotMatch(redactedLog, /inline-json-secret-123/);
    assert.match(redactedLog, /\[REDACTED_DATABASE_URL\]/);
    assert.match(redactedLog, /Bearer \[REDACTED\]/);
    assert.match(redactedLog, /Authorization: \[REDACTED\]/);
    assert.match(redactedLog, /x-revalidate-secret: \[REDACTED\]/i);
    assert.match(redactedLog, /x-api-key: \[REDACTED\]/i);
    assert.match(redactedLog, /secret=\[REDACTED\]/);
    assert.match(redactedLog, /"secret":"\[REDACTED\]"/);
    assert.match(redactedLog, /"token_env":"SKYSCANNER_PARTNER_TOKEN"/);
    assert.doesNotMatch(saved, /sky_planner:secret/);
    assert.doesNotMatch(saved, /ops-readiness-secret-123/);
    assert.doesNotMatch(saved, /secret-path/);
    assert.doesNotMatch(serializedValue, /sky_planner:secret/);
    assert.doesNotMatch(serializedValue, /ops-readiness-secret-123/);
    assert.doesNotMatch(serializedValue, /summary-token-secret-123/);
    assert.doesNotMatch(serializedValue, /inline-json-secret-123/);
    assert.match(serializedValue, /OPS_READINESS_TOKEN/);
    assert.match(serializedValue, /OPS_ALERT_WEBHOOK_URL/);
    assert.match(serializedValue, /SKYSCANNER_PARTNER_TOKEN/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("service launch audit env parser rejects malformed env files", () => {
  assert.deepEqual(parseEnvFile("FOO=bar\nexport BAZ=\"qux\"\n"), {
    FOO: "bar",
    BAZ: "qux",
  });
  assert.throws(() => parseEnvFile("NOT VALID\n"), /Invalid env file line 1/);
  assert.throws(() => parseEnvFile("1BAD=value\n"), /Invalid env name on line 1/);
});

test("service launch audit skips collector writes when preflight fails", async () => {
  const executedStepIds = [];
  const report = await runServiceLaunchAudit({
    runCollector: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      executedStepIds.push(step.id);
      const failed = step.id === "service_env_preflight";
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
      };
    },
  });
  const collectorResult = report.results.find((result) => result.id === "collect_approved_sources");
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.equal(report.status, "fail");
  assert.deepEqual(executedStepIds, [
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
    "production_readiness",
    "service_readiness",
  ]);
  assert.equal(collectorResult.status, "skipped");
  assert.equal(collectorResult.skipped_reason, "failed_prerequisite");
  assert.deepEqual(collectorResult.failed_prerequisites, ["service_env_preflight"]);
  assert.deepEqual(collectorResult.command, [
    "npm",
    "run",
    "collector:sources",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "--ingest",
    "--audit-failure",
    "--allow-partial",
  ]);
  assert.deepEqual(collectorResult.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "VERCEL_REVALIDATE_SECRET",
    "source token_env secrets referenced by manifest",
  ]);
  assert.equal(collectorResult.mutates_database, true);
  assert.match(collectorResult.started_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(collectorResult.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof collectorResult.duration_ms, "number");
  assert.deepEqual(report.summary, {
    passed: 4,
    failed: 1,
    skipped: 1,
  });
  assert.ok(report.launch_decision.decision_blockers.includes("skipped_steps_present"));
  assert.ok(itemByCheck.skipped_steps_present);
  assert.deepEqual(itemByCheck.skipped_steps_present.seen_in_steps, ["collect_approved_sources"]);
  assert.deepEqual(itemByCheck.skipped_steps_present.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "VERCEL_REVALIDATE_SECRET",
    "source token_env secrets referenced by manifest",
  ]);
  assert.ok(itemByCheck.skipped_steps_present.verify_command.includes("--run-collector"));
});

test("service launch audit skips collector writes when alert delivery fails", async () => {
  const executedStepIds = [];
  const report = await runServiceLaunchAudit({
    runCollector: true,
    continueOnFailure: true,
    stepRunner: async (step) => {
      executedStepIds.push(step.id);
      const failed = step.id === "ops_alert_delivery";
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify(
            step.id === "ops_alert_delivery"
              ? { sent: false, status: 500, validation: { ok: true } }
              : { status: "ready", failed_checks: [] },
          ),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: step.id === "ops_alert_delivery"
            ? { sent: false, status: 500, validation: { ok: true } }
            : { status: "ready", failed_checks: [] },
        },
      };
    },
  });
  const collectorResult = report.results.find((result) => result.id === "collect_approved_sources");
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.equal(report.status, "fail");
  assert.deepEqual(executedStepIds, [
    "runtime_env_preflight",
    "service_env_preflight",
    "ops_alert_delivery",
    "production_readiness",
    "service_readiness",
  ]);
  assert.equal(collectorResult.status, "skipped");
  assert.equal(collectorResult.skipped_reason, "failed_prerequisite");
  assert.deepEqual(collectorResult.failed_prerequisites, ["ops_alert_delivery"]);
  assert.equal(collectorResult.mutates_database, true);
  assert.deepEqual(report.summary, {
    passed: 4,
    failed: 1,
    skipped: 1,
  });
  assert.ok(report.launch_decision.decision_blockers.includes("ops_alert_not_sent"));
  assert.ok(report.launch_decision.decision_blockers.includes("skipped_steps_present"));
  assert.ok(itemByCheck.skipped_steps_present);
  assert.deepEqual(itemByCheck.skipped_steps_present.seen_in_steps, ["collect_approved_sources"]);
  assert.ok(itemByCheck.skipped_steps_present.verify_command.includes("--run-collector"));
});

test("service launch audit runs collector when preflight passes", async () => {
  const executedStepIds = [];
  const report = await runServiceLaunchAudit({
    runCollector: true,
    verifyReleaseGates: true,
    continueOnFailure: true,
    reportPath: "runtime/service-launch-audits/service-launch-run-collector-test.json",
    stepRunner: async (step) => {
      executedStepIds.push(step.id);
      const jsonSummary = (() => {
        if (step.id === "ops_alert_delivery") return { sent: true, status: 204, validation: { ok: true } };
        if (step.id === "collect_approved_sources") {
          return {
            status: "success",
            run_id: "collector_run_cutover",
            succeeded: 3,
            failed: 0,
            skipped: 0,
          };
        }
        if (step.id === "runtime_env_preflight" || step.id === "service_env_preflight") {
          return { status: "pass", failed_checks: [] };
        }
        return { status: "ready", failed_checks: [] };
      })();
      return {
        id: step.id,
        code: 0,
        signal: null,
        status: "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(executedStepIds.slice(0, 3), [
    "js_contract_tests",
    "python_backend_tests",
    "production_build",
  ]);
  assert.ok(executedStepIds.includes("collect_approved_sources"));
  assert.equal(report.results.every((result) => Array.isArray(result.command)), true);
  assert.equal(report.results.every((result) => Array.isArray(result.required_env)), true);
  assert.equal(report.results.every((result) => typeof result.duration_ms === "number"), true);
  assert.match(report.results[0].started_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.results[0].completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(report.summary, {
    passed: 9,
    failed: 0,
    skipped: 0,
  });
  assert.equal(report.action_plan.status, "clear");
  assert.deepEqual(report.action_plan.items, []);
});

test("service launch audit preserves step output summaries in evidence", async () => {
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    stepRunner: async (step) => ({
      id: step.id,
      code: step.id === "runtime_env_preflight" ? 1 : 0,
      signal: null,
      status: step.id === "runtime_env_preflight" ? "fail" : "pass",
      output: {
        stdout_tail: "{\"status\":\"fail\",\"summary\":{\"failed_checks\":[\"database_url_production_shape\"]}}",
        stdout_truncated: false,
        stderr_tail: "",
        stderr_truncated: false,
        json_summary: {
          status: "fail",
          failed_checks: ["database_url_production_shape"],
        },
      },
    }),
  });
  const runtimeResult = report.results.find((result) => result.id === "runtime_env_preflight");

  assert.equal(report.status, "fail");
  assert.equal(runtimeResult.output.json_summary.status, "fail");
  assert.deepEqual(runtimeResult.output.json_summary.failed_checks, ["database_url_production_shape"]);
});

test("service launch audit action plan maps failed checks to operator env and verify commands", async () => {
  // TEST-20260830-001: 매니페스트 env가 주입된 러너(collect-fares)에서 token_env가 실제
  // env 이름으로 확장되어 placeholder 단언이 깨지던 사례 방어 — audit 호출 동안 env를 차단한다.
  const savedManifestEnv = process.env.COLLECTOR_SOURCE_MANIFEST_JSON;
  delete process.env.COLLECTOR_SOURCE_MANIFEST_JSON;
  let report;
  try {
    report = await runServiceLaunchAudit({
      continueOnFailure: true,
      stepRunner: async (step) => {
        const failedChecksByStep = {
          runtime_env_preflight: ["database_url_production_shape", "mock_fallback_disabled"],
          service_env_preflight: ["collector_manifest_configured", "source_credentials_present", "source_in_policy_catalog"],
          service_readiness: ["live_collector_success", "last_batch_source_coverage", "collector_success_rate_7d", "source_health_ready", "source_policy_catalog_coverage", "booking_deeplink_sample_depth"],
        };
        const failedChecks = failedChecksByStep[step.id] ?? [];
        return {
          id: step.id,
          code: failedChecks.length > 0 ? 1 : 0,
          signal: null,
          status: failedChecks.length > 0 ? "fail" : "pass",
          output: {
            stdout_tail: JSON.stringify({ status: "fail", summary: { failed_checks: failedChecks } }),
            stdout_truncated: false,
            stderr_tail: "",
            stderr_truncated: false,
            json_summary: {
              status: failedChecks.length > 0 ? "fail" : "pass",
              failed_checks: failedChecks,
            },
          },
        };
      },
    });
  } finally {
    if (savedManifestEnv !== undefined) process.env.COLLECTOR_SOURCE_MANIFEST_JSON = savedManifestEnv;
  }
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));
  const checklistById = Object.fromEntries(report.action_plan.env_checklist.map((item) => [item.id, item]));

  assert.equal(report.action_plan.status, "action_required");
  assert.deepEqual(report.action_plan.rerun_command, [
    "npm",
    "run",
    "audit:service-launch",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "--continue-on-failure",
    "--output-dir",
    "runtime/service-launch-audits",
  ]);
  assert.deepEqual(itemByCheck.database_url_production_shape.required_env, ["DATABASE_URL"]);
  assert.deepEqual(itemByCheck.mock_fallback_disabled.required_env, ["SERVICE_REQUIRE_POSTGRES"]);
  assert.deepEqual(itemByCheck.collector_manifest_configured.required_env, ["COLLECTOR_SOURCE_MANIFEST_JSON"]);
  assert.deepEqual(itemByCheck.source_credentials_present.required_env, ["source token_env secrets referenced by manifest"]);
  assert.match(itemByCheck.source_credentials_present.operator_action, /16자 이상의 비-placeholder/);
  assert.deepEqual(itemByCheck.source_in_policy_catalog.required_env, ["COLLECTOR_SOURCE_MANIFEST_JSON"]);
  assert.deepEqual(itemByCheck.source_policy_catalog_coverage.required_env, ["COLLECTOR_SOURCE_MANIFEST_JSON"]);
  assert.deepEqual(itemByCheck.last_batch_source_coverage.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "source token_env secrets referenced by manifest",
  ]);
  assert.ok(itemByCheck.live_collector_success.verify_command.includes("--run-collector"));
  assert.ok(itemByCheck.collector_success_rate_7d.verify_command.includes("--output-dir"));
  assert.deepEqual(itemByCheck.source_health_ready.verify_command, [
    "npm",
    "run",
    "smoke:source-health",
    "--",
    "--database-url",
    "[REDACTED_DATABASE_URL]",
  ]);
  assert.deepEqual(itemByCheck.live_collector_success.seen_in_steps, ["service_readiness"]);
  assert.deepEqual(itemByCheck.booking_deeplink_sample_depth.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
  assert.match(itemByCheck.booking_deeplink_sample_depth.operator_action, /고유 예약 deeplink/);
  assert.deepEqual(checklistById.DATABASE_URL.required_by_checks, [
    "booking_deeplink_sample_depth",
    "collector_audit_missing",
    "collector_success_rate_7d",
    "database_url_production_shape",
    "evidence_checklist_not_present",
    "last_batch_source_coverage",
    "live_collector_success",
    "production_readiness_not_ready",
    "source_health_ready",
  ]);
  assert.deepEqual(checklistById.SERVICE_REQUIRE_POSTGRES.env_names, ["SERVICE_REQUIRE_POSTGRES"]);
  assert.equal(checklistById.SERVICE_REQUIRE_POSTGRES.value_shape, "true");
  assert.deepEqual(checklistById.COLLECTOR_SOURCE_MANIFEST_JSON.env_names, ["COLLECTOR_SOURCE_MANIFEST_JSON"]);
  assert.deepEqual(checklistById.source_token_env_secrets.env_names, ["manifest auth.token_env values"]);
  assert.match(checklistById.source_token_env_secrets.value_shape, /at least 16 characters/);
  assert.ok(checklistById.source_token_env_secrets.deployment_targets.includes("GitHub Actions secret"));
  assert.equal(JSON.stringify(report.action_plan.env_checklist).includes("sky_planner:secret"), false);
});

test("service launch action plan preserves service readiness operator actions", async () => {
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    stepRunner: async (step) => {
      const failed = step.id === "service_readiness";
      const jsonSummary = failed
        ? {
            status: "not_ready",
            failed_checks: ["source_credentials_present", "booking_deeplink_sample_depth"],
            operator_actions: [
              {
                check: "source_credentials_present",
                priority: 21,
                phase: "Source 설정",
                action: "manifest token env secret을 운영 값으로 주입합니다.",
                verify: "npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
                required_env: ["SKYSCANNER_PARTNER_TOKEN", "KOREAN_AIR_PARTNER_TOKEN"],
                affected_sources: ["skyscanner_affiliate", "korean_air_official"],
              },
              {
                check: "booking_deeplink_sample_depth",
                priority: 41,
                phase: "예약 전환",
                action: "source별 canonical deeplink 샘플을 5건 이상 확보합니다.",
                verify: "npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON",
                required_env: ["DATABASE_URL"],
                affected_sources: ["skyscanner_affiliate"],
              },
            ],
          }
        : { status: "pass", failed_checks: [] };
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify(jsonSummary),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));
  const checklistById = Object.fromEntries(report.action_plan.env_checklist.map((item) => [item.id, item]));

  assert.equal(itemByCheck.source_credentials_present.priority, 21);
  assert.equal(itemByCheck.source_credentials_present.phase, "Source 설정");
  assert.deepEqual(itemByCheck.source_credentials_present.required_env, [
    "KOREAN_AIR_PARTNER_TOKEN",
    "SKYSCANNER_PARTNER_TOKEN",
  ]);
  assert.equal(itemByCheck.source_credentials_present.operator_action, "manifest token env secret을 운영 값으로 주입합니다.");
  assert.equal(itemByCheck.source_credentials_present.verify_command, "npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON");
  assert.equal(itemByCheck.booking_deeplink_sample_depth.priority, 41);
  assert.equal(itemByCheck.booking_deeplink_sample_depth.phase, "예약 전환");
  assert.deepEqual(itemByCheck.booking_deeplink_sample_depth.required_env, ["DATABASE_URL"]);
  assert.deepEqual(checklistById.SKYSCANNER_PARTNER_TOKEN.env_names, ["SKYSCANNER_PARTNER_TOKEN"]);
  assert.deepEqual(checklistById.KOREAN_AIR_PARTNER_TOKEN.env_names, ["KOREAN_AIR_PARTNER_TOKEN"]);
});

test("service launch audit action plan maps production readiness aliases", async () => {
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    stepRunner: async (step) => {
      const failedChecks = step.id === "production_readiness"
        ? [
          "postgres_required_tables",
          "active_offers_present",
          "source_enabled_by_env",
          "last_batch_includes_manifest_sources",
          "manifest_sources_have_health",
          "source_readiness_ready",
          "booking_deeplink_production_shape",
          "booking_deeplink_source_coverage",
          "booking_deeplink_sample_depth",
        ]
        : [];
      return {
        id: step.id,
        code: failedChecks.length > 0 ? 1 : 0,
        signal: null,
        status: failedChecks.length > 0 ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify({ status: "not_ready", summary: { failed_checks: failedChecks } }),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: {
            status: failedChecks.length > 0 ? "not_ready" : "ready",
            failed_checks: failedChecks,
          },
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.deepEqual(itemByCheck.postgres_required_tables.required_env, ["DATABASE_URL"]);
  assert.deepEqual(itemByCheck.active_offers_present.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "source token_env secrets referenced by manifest",
  ]);
  assert.deepEqual(itemByCheck.source_enabled_by_env.required_env, [
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED",
  ]);
  assert.ok(itemByCheck.last_batch_includes_manifest_sources.verify_command.includes("--run-collector"));
  assert.ok(itemByCheck.manifest_sources_have_health.verify_command.includes("--run-collector"));
  assert.deepEqual(itemByCheck.source_readiness_ready.verify_command, [
    "npm",
    "run",
    "smoke:source-health",
    "--",
    "--database-url",
    "[REDACTED_DATABASE_URL]",
  ]);
  assert.deepEqual(itemByCheck.booking_deeplink_production_shape.verify_command, [
    "npm",
    "run",
    "smoke:prod-readiness",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
  assert.deepEqual(itemByCheck.booking_deeplink_source_coverage.required_env, [
    "DATABASE_URL",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
  ]);
  assert.deepEqual(itemByCheck.booking_deeplink_sample_depth.verify_command, [
    "npm",
    "run",
    "smoke:service-readiness",
    "--",
    "--manifest-env",
    "COLLECTOR_SOURCE_MANIFEST_JSON",
    "--notify",
  ]);
  const checklistById = Object.fromEntries(report.action_plan.env_checklist.map((item) => [item.id, item]));
  assert.deepEqual(checklistById.source_kill_switches.env_names, [
    "SOURCE_SKYSCANNER_ENABLED",
    "SOURCE_KOREAN_AIR_ENABLED",
    "SOURCE_ASIANA_ENABLED",
    "SOURCE_GOOGLE_FLIGHTS_ENABLED",
    "SOURCE_KAYAK_ENABLED",
    "SOURCE_PROMO_PAGES_ENABLED",
  ]);
});

test("service launch audit action plan maps strict source readiness env blockers", async () => {
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    stepRunner: async (step) => {
      const failedChecks = step.id === "service_readiness"
        ? ["source_kill_switches_invalid", "source_max_stale_hours_invalid"]
        : [];
      const jsonSummary = {
        status: failedChecks.length > 0
          ? "not_ready"
          : step.id === "runtime_env_preflight" || step.id === "service_env_preflight"
            ? "pass"
            : "ready",
        failed_checks: failedChecks,
      };
      return {
        id: step.id,
        code: failedChecks.length > 0 ? 1 : 0,
        signal: null,
        status: failedChecks.length > 0 ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify({ status: jsonSummary.status, summary: { failed_checks: failedChecks } }),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: jsonSummary,
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));
  const checklistById = Object.fromEntries(report.action_plan.env_checklist.map((item) => [item.id, item]));

  assert.deepEqual(itemByCheck.source_kill_switches_invalid.required_env, [
    "SOURCE_SKYSCANNER_ENABLED / SOURCE_KOREAN_AIR_ENABLED / SOURCE_ASIANA_ENABLED / SOURCE_GOOGLE_FLIGHTS_ENABLED / SOURCE_KAYAK_ENABLED / SOURCE_PROMO_PAGES_ENABLED",
  ]);
  assert.match(itemByCheck.source_kill_switches_invalid.operator_action, /true\/false/);
  assert.deepEqual(itemByCheck.source_kill_switches_invalid.verify_command, [
    "npm",
    "run",
    "preflight:runtime-env",
    "--",
  ]);
  assert.deepEqual(itemByCheck.source_max_stale_hours_invalid.required_env, ["SOURCE_MAX_STALE_HOURS"]);
  assert.match(itemByCheck.source_max_stale_hours_invalid.operator_action, /양의 정수/);
  assert.deepEqual(itemByCheck.source_max_stale_hours_invalid.verify_command, [
    "npm",
    "run",
    "preflight:runtime-env",
    "--",
  ]);
  assert.deepEqual(checklistById.source_kill_switches.required_by_checks, [
    "collector_audit_missing",
    "evidence_checklist_not_present",
    "source_kill_switches_invalid",
  ]);
  assert.deepEqual(checklistById.SOURCE_MAX_STALE_HOURS.required_by_checks, [
    "collector_audit_missing",
    "evidence_checklist_not_present",
    "source_max_stale_hours_invalid",
  ]);
  assert.equal(JSON.stringify(report.action_plan.items).includes("실패 detail"), false);
});

test("service launch audit action plan keeps failed alert delivery step visible", async () => {
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    stepRunner: async (step) => {
      if (step.id === "ops_alert_delivery") {
        return {
          id: step.id,
          code: 1,
          signal: null,
          status: "fail",
          output: {
            stdout_tail: JSON.stringify({ sent: false, status: 500, validation: { ok: true } }),
            stdout_truncated: false,
            stderr_tail: "",
            stderr_truncated: false,
            json_summary: {
              sent: false,
              status: 500,
            },
          },
        };
      }
      const failed = step.id === "service_readiness";
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify({ status: failed ? "not_ready" : "ready", summary: { failed_checks: failed ? ["source_credentials_present"] : [] } }),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: {
            status: failed ? "not_ready" : "ready",
            failed_checks: failed ? ["source_credentials_present"] : [],
          },
        },
      };
    },
  });
  const itemByCheck = Object.fromEntries(report.action_plan.items.map((item) => [item.check, item]));

  assert.ok(itemByCheck.source_credentials_present);
  assert.ok(itemByCheck["step:ops_alert_delivery"]);
  assert.deepEqual(itemByCheck["step:ops_alert_delivery"].required_env, ["OPS_ALERT_WEBHOOK_URL"]);
  assert.deepEqual(itemByCheck["step:ops_alert_delivery"].verify_command, [
    "npm",
    "run",
    "smoke:ops-alert",
    "--",
    "--event",
    "collector_ops_alert_smoke",
  ]);
  assert.equal(report.launch_decision.ops_alert_step_status, "fail");
  assert.equal(report.launch_decision.ops_alert_sent, false);
});

test("service launch audit env checklist expands manifest token env names without values", async () => {
  const manifest = {
    schema_version: "collector.source_manifest.v1",
    sources: [
      {
        config: {
          source_id: "skyscanner_affiliate",
          auth: { token_env: "SKYSCANNER_PARTNER_TOKEN" },
        },
      },
      {
        config: {
          source_id: "korean_air_official",
          auth: { token_env: "KOREAN_AIR_PARTNER_TOKEN" },
        },
      },
      {
        enabled: false,
        config: {
          source_id: "paused_source",
          auth: { token_env: "PAUSED_SOURCE_TOKEN" },
        },
      },
    ],
  };
  const report = await runServiceLaunchAudit({
    continueOnFailure: true,
    envOverrides: {
      COLLECTOR_SOURCE_MANIFEST_JSON: JSON.stringify(manifest),
      SKYSCANNER_PARTNER_TOKEN: "skyscanner-live-secret-123",
      KOREAN_AIR_PARTNER_TOKEN: "korean-air-live-secret-123",
    },
    stepRunner: async (step) => {
      const failed = step.id === "service_readiness";
      return {
        id: step.id,
        code: failed ? 1 : 0,
        signal: null,
        status: failed ? "fail" : "pass",
        output: {
          stdout_tail: JSON.stringify({ status: "fail", summary: { failed_checks: failed ? ["source_credentials_present"] : [] } }),
          stdout_truncated: false,
          stderr_tail: "",
          stderr_truncated: false,
          json_summary: {
            status: failed ? "fail" : "pass",
            failed_checks: failed ? ["source_credentials_present"] : [],
          },
        },
      };
    },
  });
  const sourceSecrets = report.action_plan.env_checklist.find((item) => item.id === "source_token_env_secrets");
  const payload = JSON.stringify(report.action_plan.env_checklist);

  assert.deepEqual(sourceSecrets.env_names, [
    "KOREAN_AIR_PARTNER_TOKEN",
    "SKYSCANNER_PARTNER_TOKEN",
  ]);
  assert.equal(sourceSecrets.provided_in_rehearsal, true);
  assert.doesNotMatch(payload, /skyscanner-live-secret-123/);
  assert.doesNotMatch(payload, /korean-air-live-secret-123/);
  assert.doesNotMatch(payload, /PAUSED_SOURCE_TOKEN/);
});

test("collector workflow uploads service launch audit evidence", async () => {
  const workflow = await readFile(path.join(process.cwd(), ".github/workflows/collect-fares.yml"), "utf-8");

  assert.match(workflow, /npm run audit:service-launch/);
  assert.match(workflow, /--verify-release-gates/);
  assert.match(workflow, /--run-collector/);
  assert.match(workflow, /--continue-on-failure/);
  assert.match(workflow, /--output-dir runtime\/service-launch-audits/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name: collector-artifacts/);
  assert.match(workflow, /path: runtime\/collector-artifacts/);
  assert.match(workflow, /name: collector-artifacts[\s\S]*if-no-files-found: error/);
  assert.match(workflow, /OPS_READINESS_TOKEN/);
  assert.match(workflow, /SERVICE_REQUIRE_POSTGRES: "true"/);
  assert.match(workflow, /name: service-launch-audit/);
  assert.match(workflow, /path: runtime\/service-launch-audits/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /retention-days: 90/);
});
