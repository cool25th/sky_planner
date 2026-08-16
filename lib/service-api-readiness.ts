import { serviceRequiresPostgres } from "./service-mode.ts";

export interface ServiceApiReadinessInput {
  postgresConfigured?: boolean;
  sourceHealthError?: string | null;
  sourceReadiness?: {
    status?: string | null;
  } | null;
}

export function serviceApiReadinessBlockReason(
  input: ServiceApiReadinessInput,
  env: Record<string, string | undefined> = process.env,
) {
  if (!serviceRequiresPostgres(env) || !input.postgresConfigured) return null;
  if (input.sourceHealthError) return "source_health_unavailable";
  if (!input.sourceReadiness) return "source_readiness_unavailable";
  if (input.sourceReadiness.status !== "ready") return "source_readiness_not_ready";
  return null;
}
