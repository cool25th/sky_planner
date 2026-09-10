import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { isRevalidateRequestAuthorized } from "@/lib/revalidate-auth";

// UX-20260910-007: 외부 관측(6시간 합성 체크)의 하트비트 기록 — launch-gate 4축 "실패 감지
// 가능"의 증거 원천. 러너에 node_modules가 없어도 되도록 HTTP 입력(기존 VERCEL_REVALIDATE_SECRET,
// 타이밍-세이프 비교 재사용)으로 받아 서버에서 batch_state에 기록한다.
export const dynamic = "force-dynamic";

const HEARTBEAT_KEYS = new Set([
  "ran_at",
  "status",
  "map_mode",
  "live_deals",
  "map_cities",
  "offers_sample_size",
  "offers_dedup_violations",
  "pickable_deals",
  "regressions",
]);

export async function POST(request: Request) {
  if (!isRevalidateRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // 화이트리스트 키만 남긴다 — 관측 메트릙 외 주입을 구조적으로 차단.
  const data: Record<string, unknown> = {};
  for (const key of HEARTBEAT_KEYS) {
    if (payload[key] !== undefined) data[key] = payload[key];
  }
  if (typeof data.ran_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(data.ran_at)) {
    return NextResponse.json({ error: "ran_at_required" }, { status: 400 });
  }
  try {
    await query(`
      INSERT INTO batch_state (key, data)
      VALUES ('synthetic_check', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [JSON.stringify(data)]);
    return NextResponse.json({ recorded: true, keys: Object.keys(data) });
  } catch {
    return NextResponse.json({ error: "heartbeat_write_failed" }, { status: 503 });
  }
}
