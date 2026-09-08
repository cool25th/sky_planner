import "server-only";

import {
  type ApiResponse,
  buildSearchResult,
  type CalendarData,
  type CalendarQuery,
  DEFAULT_LAST_BATCH_AT,
  envelope,
  GENERATED_AT,
  getCalendarData,
  getMapData,
  type getMetaData,
  getOffersData,
  getSearchResults,
  type MapData,
  type MapQuery,
  type OffersData,
  type OffersQuery,
  type SearchQuery,
  type SearchResult,
} from "@/lib/mock-market";
import { getBatchState } from "@/lib/runtime-state";
import { serviceRequiresPostgres } from "@/lib/service-mode";
import { enabledSourceFlagsFromEnv } from "@/lib/source-policy";
import { emptyCalendarDataForQuery, resolveCalendarDataFromPostgres } from "./read-model/calendar-query";
import {
  addDiagnostics,
  sanitizedPostgresFailure,
  sourceReadinessFallbackReason,
  suppressMockFallback,
} from "./read-model/diagnostics";
import { emptyMapDataForQuery, resolveMapDataFromPostgres } from "./read-model/map-query";
import { emptyOffersDataForQuery, resolveOffersDataFromPostgres } from "./read-model/offers-query";
import { buildMetaFromSourceFlags } from "./read-model/row-mappers";
import { resolveSearchDataFromPostgres } from "./read-model/search-query";
import { postgresConfigured, resolveSourceContext, type SourceContext } from "./read-model/source-context";
import { eligibleReadModelSourceKeys } from "@/lib/read-model-source-filter";

const MOCK_FALLBACK_WARNING_FLAGS = ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"];

// INT-20260829-001: BFF 응답의 generated_at은 실제 응답 생성 시각이다 — mock 빌드 상수(GENERATED_AT)를
// 실으면 live 응답이 실제와 무관한 고정 시각을 주장한다. request_id 해시는 그대로 둔다(결정론 유지).
function liveEnvelope<T>(
  prefix: string,
  payload: Record<string, string>,
  data: T,
  lastBatchAt: string,
  sourceFlags?: string[],
) {
  return { ...envelope(prefix, payload, data, lastBatchAt, sourceFlags), generated_at: new Date().toISOString() };
}

interface ResponseResolution<Q, D> {
  endpoint: string;
  queryParams: Record<string, string>;
  postgresWarningFlags?: string[];
  resolveFromPostgres: (query: Q, lastBatchAt: string, sourceFlags: string[]) => Promise<D | null>;
  mockData: (query: Q, lastBatchAt: string, sourceFlags: string[]) => D;
  // DATA-20260908-001: 운영 폴백은 live → last-good(관측시각 포함) → 빈 결과+사유.
  // mock 페이로드는 비운영(미설정 환경) 전용으로 남는다.
  emptyData: (query: Q) => D;
  liveContentCount: (data: D) => number;
}

const LAST_GOOD_WARNING_FLAGS = ["stale_last_good_data", "daily_batch_cached", "final_price_check_on_booking_source"];

// H2(2026-09-08 핫픽스): last-good으로 되살리면 안 되는 차단 사유 — 운영자가 명시적으로 끈 소스
// (paused·kill switch)와 신뢰 붕괴(circuit breaker·반복 실패·성공 이력 부재·health 행 부재).
// "stale"(신선도 마감)만 관측시각 스탬프와 함께 마지막 정상 데이터로 완화한다.
const NON_REVIVABLE_BLOCK_REASONS = new Set([
  "paused",
  "disabled_by_health",
  "circuit_breaker_open",
  "consecutive_failures",
  "never_successful",
  "missing_source_health",
]);

export function lastGoodSourceFlags(sourceContext: SourceContext): string[] {
  const blockReasons = sourceContext.sourceBlockReasons ?? {};
  return enabledSourceFlagsFromEnv().filter((sourceId) => {
    const reason = blockReasons[sourceId];
    return reason === null || reason === undefined || !NON_REVIVABLE_BLOCK_REASONS.has(reason);
  });
}

function staleGateBlocked(sourceContext: SourceContext): boolean {
  return Object.values(sourceContext.sourceBlockReasons ?? {}).includes("stale");
}

function unavailableResponse<Q, D>(
  plan: ResponseResolution<Q, D>,
  query: Q,
  batchState: { lastBatchAt: string },
  sourceContext: Awaited<ReturnType<typeof resolveSourceContext>>,
  fallbackReason: string | null,
) {
  return suppressMockFallback(
    liveEnvelope(plan.endpoint, plan.queryParams, plan.emptyData(query), batchState.lastBatchAt, sourceContext.sourceFlags),
    sourceContext,
    fallbackReason,
  );
}

async function resolveLastGoodResponse<Q, D>(
  query: Q,
  plan: ResponseResolution<Q, D>,
  batchState: { lastBatchAt: string },
  sourceContext: Awaited<ReturnType<typeof resolveSourceContext>>,
  fallbackReason: string | null,
) {
  // H2: last-good은 스테일 게이트(소스 신선도 마감, readiness not_ready + stale 차단 존재)에서만.
  // 쿼리 실패·health 조회 실패 등 그 외 차단은 빈 결과+사유로 응답한다.
  if (fallbackReason !== "source_readiness_not_ready" || !staleGateBlocked(sourceContext)) return null;
  // 차단 목록(비신선 사유)을 뺀 플래그로만 재조회 — env 킬스위치 전체를 다시 켜지 않는다.
  const lastGoodFlags = lastGoodSourceFlags(sourceContext);
  if (!lastGoodFlags.length || !postgresConfigured()) return null;
  try {
    const data = await plan.resolveFromPostgres(query, batchState.lastBatchAt, lastGoodFlags);
    if (!data || plan.liveContentCount(data) === 0) return null;
    return addDiagnostics(
      {
        ...liveEnvelope(plan.endpoint, plan.queryParams, data, batchState.lastBatchAt, lastGoodFlags),
        warning_flags: LAST_GOOD_WARNING_FLAGS,
      },
      "last_good",
      sourceContext,
      fallbackReason,
    );
  } catch (err) {
    console.error("Failed to resolve last-known-good read model data.", err);
    return null;
  }
}

async function resolveReadModelResponse<Q, D>(query: Q, plan: ResponseResolution<Q, D>): Promise<ApiResponse<D>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    // DATA-20260908-001: 소스 게이트 차단(스테일 연쇄)은 데모 주입이 아니라
    // last-good 스냅샷(스탬프·경고 포함) 또는 빈 결과+사유로 응답한다.
    const lastGood = await resolveLastGoodResponse(query, plan, batchState, sourceContext, readinessFallbackReason);
    if (lastGood) return lastGood;
    return unavailableResponse(plan, query, batchState, sourceContext, readinessFallbackReason);
  }

  let fallbackReason: string | null = null;
  try {
    const postgresData = await plan.resolveFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        {
          ...liveEnvelope(plan.endpoint, plan.queryParams, postgresData, batchState.lastBatchAt, sourceFlags),
          ...(plan.postgresWarningFlags ? { warning_flags: plan.postgresWarningFlags } : {}),
        },
        "postgres",
        sourceContext,
      );
    }
    // INT-20260908-001: 승인 소스가 전부 차단되면 map/calendar/offers의 소스 게이트가 쿼리 실행 없이
    // null을 반환한다 — "행 없음"과 구분해 기록해야 스테일 연쇄와 데이터 부재를 오퍼레이터가 구분할 수 있다.
    fallbackReason = !postgresConfigured()
      ? "postgres_not_configured"
      : eligibleReadModelSourceKeys(sourceFlags).size
        ? "postgres_no_matching_rows"
        : "postgres_no_eligible_sources";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  // H1(2026-09-08 핫픽스): postgres가 구성된 환경에서는 SERVICE_REQUIRE_POSTGRES와 무관하게
  // mock 페이로드를 조립하지 않는다 — 프로덕션 실측 service_requires_postgres=false인 채로
  // 쿼리 실패(콜드스타트 등)가 데모 가격으로 떨어지던 구멍. 쿼리 실패는 last-good 대상이
  // 아니므로([H2] 스테일 게이트 전용) 빈 결과+사유로 응답한다. mock은 미구성 로컬/테스트만.
  if (postgresConfigured() || serviceRequiresPostgres()) {
    return unavailableResponse(plan, query, batchState, sourceContext, fallbackReason);
  }

  return addDiagnostics(
    {
      ...liveEnvelope(plan.endpoint, plan.queryParams, plan.mockData(query, batchState.lastBatchAt, sourceFlags), batchState.lastBatchAt, sourceFlags),
      warning_flags: MOCK_FALLBACK_WARNING_FLAGS,
    },
    "mock",
    sourceContext,
    fallbackReason,
  );
}

export async function resolveMetaResponse(): Promise<ApiResponse<ReturnType<typeof getMetaData> & { source_flags?: string[] }>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  return addDiagnostics(
    liveEnvelope("meta", {}, buildMetaFromSourceFlags(sourceContext.sourceFlags), batchState.lastBatchAt, sourceContext.sourceFlags),
    postgresConfigured() ? "postgres" : "mock",
    sourceContext,
  );
}

export async function resolveMapResponse(mapQuery: MapQuery): Promise<ApiResponse<MapData>> {
  return resolveReadModelResponse<MapQuery, MapData>(mapQuery, {
    endpoint: "deals-map",
    queryParams: {
      origin: mapQuery.origin,
      week: mapQuery.week,
      region: mapQuery.region,
      stay_bucket: mapQuery.stay_bucket,
      traveler: mapQuery.traveler,
      cabin: mapQuery.cabin,
      airlines: mapQuery.airlines.join(","),
    },
    postgresWarningFlags: ["daily_batch_cached"],
    resolveFromPostgres: resolveMapDataFromPostgres,
    mockData: getMapData,
    emptyData: emptyMapDataForQuery,
    liveContentCount: (data) => data.deals.length,
  });
}

export async function resolveCalendarResponse(calendarQuery: CalendarQuery): Promise<ApiResponse<CalendarData>> {
  return resolveReadModelResponse<CalendarQuery, CalendarData>(calendarQuery, {
    endpoint: "deals-calendar",
    queryParams: {
      origin: calendarQuery.origin,
      week: calendarQuery.week,
      destination: calendarQuery.destination,
      stay_bucket: calendarQuery.stay_bucket,
      traveler: calendarQuery.traveler,
      cabin: calendarQuery.cabin,
      airlines: calendarQuery.airlines.join(","),
    },
    resolveFromPostgres: resolveCalendarDataFromPostgres,
    mockData: getCalendarData,
    emptyData: emptyCalendarDataForQuery,
    liveContentCount: (data) => data.cells.length,
  });
}

export async function resolveOffersResponse(offersQuery: OffersQuery): Promise<ApiResponse<OffersData>> {
  return resolveReadModelResponse<OffersQuery, OffersData>(offersQuery, {
    endpoint: "offers",
    queryParams: {
      origin: offersQuery.origin,
      week: offersQuery.week,
      destination: offersQuery.destination,
      depart: offersQuery.depart,
      return: offersQuery.return,
      traveler: offersQuery.traveler,
      cabin: offersQuery.cabin,
      airline: offersQuery.airline.join(","),
      stops: offersQuery.stops,
    },
    resolveFromPostgres: resolveOffersDataFromPostgres,
    mockData: getOffersData,
    emptyData: emptyOffersDataForQuery,
    liveContentCount: (data) => data.offers.length,
  });
}

export async function resolveSearchResponse(searchQuery: SearchQuery): Promise<ApiResponse<SearchResult>> {
  return resolveReadModelResponse<SearchQuery, SearchResult>(searchQuery, {
    endpoint: "fare-search",
    queryParams: {
      origin: searchQuery.origin,
      destination: searchQuery.destination,
      q: searchQuery.destination_input,
      days: String(searchQuery.days),
      flex: String(searchQuery.flex_days),
      cabin: searchQuery.cabin,
    },
    postgresWarningFlags: ["daily_batch_cached", "final_price_check_on_booking_source"],
    resolveFromPostgres: resolveSearchDataFromPostgres,
    mockData: getSearchResults,
    emptyData: (query) => buildSearchResult(query, null, [], []),
    liveContentCount: (data) => data.offers.length,
  });
}

export { dataModeLabel } from "./read-model/diagnostics";

export function defaultBatchAt() {
  return DEFAULT_LAST_BATCH_AT;
}

export function generatedAt() {
  return GENERATED_AT;
}
