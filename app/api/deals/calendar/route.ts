import { NextRequest, NextResponse } from "next/server";

import { apiHeadersForResponse, apiStatusForResponse } from "@/lib/api-response-policy";
import { resolveCalendarResponse } from "@/lib/data-source";
import { parseCalendarQuery } from "@/lib/mock-market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = parseCalendarQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const response = await resolveCalendarResponse(query);
  return NextResponse.json(response, {
    status: apiStatusForResponse(response),
    headers: apiHeadersForResponse(response),
  });
}
