import "server-only";

import {
  DEFAULT_LAST_BATCH_AT,
  GENERATED_AT,
  type ApiResponse,
  type CalendarData,
  type CalendarQuery,
  type MapData,
  type MapQuery,
  type OffersData,
  type OffersQuery,
  type SearchQuery,
  type SearchResult,
  envelope,
  getCalendarData,
  getMapData,
  type getMetaData,
  getOffersData,
  getSearchResults,
} from "@/lib/mock-market";
import { getBatchState } from "@/lib/runtime-state";
import { serviceRequiresPostgres } from "@/lib/service-mode";
import { resolveCalendarDataFromPostgres } from "./read-model/calendar-query";
import { resolveMapDataFromPostgres } from "./read-model/map-query";
import { resolveOffersDataFromPostgres } from "./read-model/offers-query";
import { resolveSearchDataFromPostgres } from "./read-model/search-query";
import {
  addDiagnostics,
  sanitizedPostgresFailure,
  sourceReadinessFallbackReason,
  suppressMockFallback,
} from "./read-model/diagnostics";
import { buildMetaFromSourceFlags } from "./read-model/row-mappers";
import { postgresConfigured, resolveSourceContext } from "./read-model/source-context";

const MOCK_FALLBACK_WARNING_FLAGS = ["mock_data_source", "daily_batch_cached", "final_price_check_on_booking_source"];

interface ResponseResolution<Q, D> {
  endpoint: string;
  queryParams: Record<string, string>;
  postgresWarningFlags?: string[];
  resolveFromPostgres: (query: Q, lastBatchAt: string, sourceFlags: string[]) => Promise<D | null>;
  mockData: (query: Q, lastBatchAt: string, sourceFlags: string[]) => D;
}

async function resolveReadModelResponse<Q, D>(query: Q, plan: ResponseResolution<Q, D>): Promise<ApiResponse<D>> {
  const batchState = await getBatchState();
  const sourceContext = await resolveSourceContext(batchState);
  const sourceFlags = sourceContext.sourceFlags;
  const readinessFallbackReason = sourceReadinessFallbackReason(sourceContext);
  if (readinessFallbackReason) {
    return suppressMockFallback(
      envelope(plan.endpoint, plan.queryParams, plan.mockData(query, batchState.lastBatchAt, []), batchState.lastBatchAt, sourceFlags),
      sourceContext,
      readinessFallbackReason,
    );
  }

  let fallbackReason: string | null = null;
  try {
    const postgresData = await plan.resolveFromPostgres(query, batchState.lastBatchAt, sourceFlags);
    if (postgresData) {
      return addDiagnostics(
        {
          ...envelope(plan.endpoint, plan.queryParams, postgresData, batchState.lastBatchAt, sourceFlags),
          ...(plan.postgresWarningFlags ? { warning_flags: plan.postgresWarningFlags } : {}),
        },
        "postgres",
        sourceContext,
      );
    }
    fallbackReason = postgresConfigured() ? "postgres_no_matching_rows" : "postgres_not_configured";
  } catch (err) {
    fallbackReason = sanitizedPostgresFailure(err);
  }

  if (serviceRequiresPostgres()) {
    return suppressMockFallback(
      envelope(plan.endpoint, plan.queryParams, plan.mockData(query, batchState.lastBatchAt, []), batchState.lastBatchAt, sourceFlags),
      sourceContext,
      fallbackReason,
    );
  }

  return addDiagnostics(
    {
      ...envelope(plan.endpoint, plan.queryParams, plan.mockData(query, batchState.lastBatchAt, sourceFlags), batchState.lastBatchAt, sourceFlags),
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
    envelope("meta", {}, buildMetaFromSourceFlags(sourceContext.sourceFlags), batchState.lastBatchAt, sourceContext.sourceFlags),
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
  });
}

export { dataModeLabel } from "./read-model/diagnostics";

export function defaultBatchAt() {
  return DEFAULT_LAST_BATCH_AT;
}

export function generatedAt() {
  return GENERATED_AT;
}
