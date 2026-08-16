import type { ApiResponse } from "./mock-market.ts";
import { isServiceUnavailableDiagnostics } from "./service-unavailable.ts";

export function apiStatusForResponse(response: ApiResponse<unknown>) {
  return isServiceUnavailableDiagnostics(response.diagnostics) ? 503 : 200;
}

export function apiHeadersForResponse(response: ApiResponse<unknown>) {
  return isServiceUnavailableDiagnostics(response.diagnostics)
    ? { "Cache-Control": "no-store" }
    : undefined;
}
