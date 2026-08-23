import { type NextRequest, NextResponse } from "next/server";

import { apiHeadersForResponse, apiStatusForResponse } from "@/lib/api-response-policy";
import { resolveOffersResponse } from "@/lib/data-source";
import { parseOffersQuery } from "@/lib/mock-market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = parseOffersQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const response = await resolveOffersResponse(query);
  return NextResponse.json(response, {
    status: apiStatusForResponse(response),
    headers: apiHeadersForResponse(response),
  });
}
