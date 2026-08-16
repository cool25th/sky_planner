import { NextResponse } from "next/server";

import { resolveMetaResponse } from "@/lib/data-source";

export const revalidate = 86400;

export async function GET() {
  return NextResponse.json(await resolveMetaResponse());
}
