import { NextRequest, NextResponse } from "next/server";

import { apiHeadersForResponse, apiStatusForResponse } from "@/lib/api-response-policy";
import { resolveSearchResponse } from "@/lib/data-source";
import { parseSearchQuery } from "@/lib/mock-market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = parseSearchQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const response = await resolveSearchResponse(query);
  return NextResponse.json(response, {
    status: apiStatusForResponse(response),
    headers: apiHeadersForResponse(response),
  });
}
