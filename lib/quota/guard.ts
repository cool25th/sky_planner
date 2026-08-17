export interface WriteBudget {
  service_state_writes: number;
  source_state_writes: number;
  batch_writes: number;
  current_view_writes: number;
  offer_writes: number;
  total_writes: number;
}

export const QUOTA_LIMITS = {
  MAX_DAILY_WRITES: 12000,
  MAX_DAILY_READS: 30000,
  MAX_STORAGE_MB: 600,
  MAX_DEALS_PER_VIEW: 200,
  MAX_OFFERS_PER_ROUTE: 3,
};

export function calculateEstimatedWrites(params: {
  sourceCount: number;
  viewCount: number;
  offerCount: number;
}): WriteBudget {
  const service_state_writes = 1;
  const source_state_writes = params.sourceCount;
  const batch_writes = 1;
  const current_view_writes = params.viewCount;
  const offer_writes = params.offerCount;

  const total_writes =
    service_state_writes +
    source_state_writes +
    batch_writes +
    current_view_writes +
    offer_writes;

  return {
    service_state_writes,
    source_state_writes,
    batch_writes,
    current_view_writes,
    offer_writes,
    total_writes,
  };
}

export function validateWriteQuota(budget: WriteBudget): { ok: boolean; reason?: string } {
  if (budget.total_writes > QUOTA_LIMITS.MAX_DAILY_WRITES) {
    return {
      ok: false,
      reason: `Estimated writes (${budget.total_writes}) exceed Spark plan daily limit of ${QUOTA_LIMITS.MAX_DAILY_WRITES}`,
    };
  }
  return { ok: true };
}
