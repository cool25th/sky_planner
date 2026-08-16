import { NextResponse } from "next/server";

import {
  enrichInternalServiceReadinessSnapshot,
  opsJsonHeaders,
  redactServiceReadinessSnapshot,
  resolveOpsRequestVisibility,
} from "@/lib/ops-visibility";
import { getServiceReadinessSnapshot } from "@/lib/service-readiness-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = resolveOpsRequestVisibility(request);
  const snapshot = await getServiceReadinessSnapshot();
  const payload = access.visibility === "internal"
    ? enrichInternalServiceReadinessSnapshot(snapshot)
    : redactServiceReadinessSnapshot(snapshot);

  return NextResponse.json(payload, {
    status: snapshot.status === "ready" ? 200 : 503,
    headers: opsJsonHeaders(access.visibility),
  });
}
