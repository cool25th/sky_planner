import { NextResponse } from "next/server";

import { readLaunchGate } from "@/lib/launch-gate";

// 완료정의[5]: 출시·인덱싱 게이트(운영 관측용). service-readiness 45항과 별개의 P0 축 —
// 스테일 최저가·데모 폴백·주간 픽·실패 감지. 게이트 실패는 noindex/사이트맵 축소의 근거가 된다.
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await readLaunchGate();
  return NextResponse.json(
    {
      gate: "launch_indexing",
      passed: gate.passed,
      stale_lowest_price_pct: gate.stale_lowest_price_pct,
      checks: gate.checks,
      generated_at: new Date().toISOString(),
    },
    { status: gate.passed ? 200 : 503 },
  );
}
