import "server-only";

import { resolveMapResponse } from "./data-source";
import type { ApiResponse, MapData, MapQuery } from "./mock-market";
import { isServiceUnavailableDiagnostics } from "./service-unavailable";

// UX-20260830-003: 기본 진입(week 미지정)에서 현재 주간 특가가 소진(주 후반 0딜)되면
// 다음 주간 실데이터로 자동 진행한다. 사용자가 week을 명시했다면 그 선택을 존중하고,
// 서비스 장애(503 계열)는 자동 진행 대상이 아니다. 데모 프리뷰로 속이지 않는
// honest empty 정책(UX-20260828-001)은 유지된다 — 다음 주에도 딜이 없으면 빈 상태 그대로.

export interface MapResponseWithBookableWeek {
  response: ApiResponse<MapData>;
  week: string;
  weekAdvancedFrom: string | null;
}

export async function resolveMapResponseWithBookableWeek(
  query: MapQuery,
  options: { explicitWeek: boolean; nextWeek: string | null; resolve?: typeof resolveMapResponse },
): Promise<MapResponseWithBookableWeek> {
  const resolve = options.resolve ?? resolveMapResponse;
  const nextWeek = options.nextWeek;
  const response = await resolve(query);
  if (
    options.explicitWeek ||
    nextWeek === null ||
    response.data.deals.length > 0 ||
    isServiceUnavailableDiagnostics(response.diagnostics)
  ) {
    return { response, week: query.week, weekAdvancedFrom: null };
  }

  const advanced = await resolve({ ...query, week: nextWeek });
  if (advanced.data.deals.length === 0 || isServiceUnavailableDiagnostics(advanced.diagnostics)) {
    return { response, week: query.week, weekAdvancedFrom: null };
  }
  return { response: advanced, week: nextWeek, weekAdvancedFrom: query.week };
}
