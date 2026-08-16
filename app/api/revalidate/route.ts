import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { isRevalidateRequestAuthorized } from "@/lib/revalidate-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isRevalidateRequestAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  revalidatePath("/");
  revalidatePath("/map");
  revalidatePath("/offers");
  return NextResponse.json({ ok: true, revalidated: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
