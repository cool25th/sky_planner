import { QUOTA_LIMITS } from "../lib/quota/guard.ts";

export function auditFirestoreQuota(params = {}) {
  const estimatedDailyReads = params.estimatedDailyReads || 1500;
  const estimatedDailyWrites = params.estimatedDailyWrites || 2200;
  const estimatedStorageMb = params.estimatedStorageMb || 15;

  const readOk = estimatedDailyReads <= QUOTA_LIMITS.MAX_DAILY_READS;
  const writeOk = estimatedDailyWrites <= QUOTA_LIMITS.MAX_DAILY_WRITES;
  const storageOk = estimatedStorageMb <= QUOTA_LIMITS.MAX_STORAGE_MB;

  const passed = readOk && writeOk && storageOk;

  return {
    plan: "Firebase Spark Plan (Free Tier)",
    billing_attached: false,
    quota_checks: {
      daily_reads: {
        estimated: estimatedDailyReads,
        safe_limit: QUOTA_LIMITS.MAX_DAILY_READS,
        spark_limit: 50000,
        pass: readOk,
      },
      daily_writes: {
        estimated: estimatedDailyWrites,
        safe_limit: QUOTA_LIMITS.MAX_DAILY_WRITES,
        spark_limit: 20000,
        pass: writeOk,
      },
      storage_mb: {
        estimated: estimatedStorageMb,
        safe_limit: QUOTA_LIMITS.MAX_STORAGE_MB,
        spark_limit: 1024,
        pass: storageOk,
      },
    },
    passed,
    decision: passed ? "quota_compliant" : "quota_exceeded",
  };
}

function main() {
  const result = auditFirestoreQuota();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
