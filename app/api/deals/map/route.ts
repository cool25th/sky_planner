import { NextRequest, NextResponse } from "next/server";

import { apiHeadersForResponse, apiStatusForResponse } from "@/lib/api-response-policy";
import { resolveMapResponse } from "@/lib/data-source";
import { parseMapQuery } from "@/lib/mock-market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = parseMapQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const response = await resolveMapResponse(query);
  return NextResponse.json(response, {
    status: apiStatusForResponse(response),
    headers: apiHeadersForResponse(response),
  });
}
