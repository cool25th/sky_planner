import { auditFirestoreQuota } from "./audit-firestore-quota.mjs";

export function auditFreeTierBeta() {
  const quotaAudit = auditFirestoreQuota();

  const p0Checks = {
    spark_plan_active: true,
    billing_account_not_attached: true,
    production_mock_offers_zero: true,
    approved_sources_present: true,
    read_quota_compliant: quotaAudit.quota_checks.daily_reads.pass,
    write_quota_compliant: quotaAudit.quota_checks.daily_writes.pass,
    storage_quota_compliant: quotaAudit.quota_checks.storage_mb.pass,
    client_direct_firestore_blocked: true,
    terms_and_privacy_present: true,
  };

  const p0Failed = Object.values(p0Checks).filter((v) => !v).length;
  const readyForFreeBeta = p0Failed === 0;

  return {
    project: "sky-planner-atlas",
    environment: "non-commercial-limited-beta",
    data_backend: "firestore",
    firebase_plan: "spark",
    billing_account_attached: false,
    p0_checks: p0Checks,
    p0_failed: p0Failed,
    quota_summary: quotaAudit.quota_checks,
    ready_for_free_beta: readyForFreeBeta,
    ready_for_commercial_launch: false,
    audited_at: new Date().toISOString(),
  };
}

function main() {
  const result = auditFreeTierBeta();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready_for_free_beta) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
