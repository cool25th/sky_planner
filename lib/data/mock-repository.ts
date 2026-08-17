import type {
  CalendarData,
  CalendarQuery,
  MapDeal,
  MapQuery,
  OffersData,
  OffersQuery,
  SearchQuery,
  SearchResult,
} from "../mock-market.ts";
import {
  DEFAULT_LAST_BATCH_AT,
  getCalendarData,
  getMapData,
  getOffersData,
  getSearchResults,
} from "../mock-market.ts";
import type { FlightDataRepository, ServiceState, SourceHealthSnapshot } from "./repository.ts";

export class MockRepository implements FlightDataRepository {
  async getServiceState(): Promise<ServiceState> {
    return {
      environment: "development",
      release_version: "1.0.0-mock",
      current_batch_id: "batch-local-mock",
      previous_batch_id: null,
      last_successful_publish_at: new Date().toISOString(),
      data_status: "ready",
      active_source_ids: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
      mock_data_enabled: true,
      updated_at: new Date().toISOString(),
    };
  }

  async getMapDeals(query: MapQuery): Promise<MapDeal[]> {
    const data = getMapData(query, DEFAULT_LAST_BATCH_AT);
    return data.deals;
  }

  async getCalendarDeals(query: CalendarQuery): Promise<CalendarData> {
    return getCalendarData(query, DEFAULT_LAST_BATCH_AT);
  }

  async getOffers(query: OffersQuery): Promise<OffersData> {
    return getOffersData(query, DEFAULT_LAST_BATCH_AT);
  }

  async getSearchResults(query: SearchQuery): Promise<SearchResult> {
    return getSearchResults(query, DEFAULT_LAST_BATCH_AT);
  }

  async getSourceHealth(): Promise<SourceHealthSnapshot> {
    return {
      status: "ready",
      counts: {
        total: 3,
        healthy: 3,
        paused: 0,
        circuit_open: 0,
      },
      blocked_source_ids: [],
      source_flags: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
    };
  }
}
