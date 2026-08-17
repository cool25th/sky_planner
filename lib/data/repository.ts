import type {
  CalendarData,
  CalendarQuery,
  MapDeal,
  MapQuery,
  Offer,
  OffersData,
  OffersQuery,
  SearchQuery,
  SearchResult,
} from "../mock-market.ts";

export interface ServiceState {
  environment: string;
  release_version: string;
  current_batch_id: string;
  previous_batch_id: string | null;
  last_successful_publish_at: string;
  data_status: "ready" | "stale" | "maintenance" | "uninitialized";
  active_source_ids: string[];
  mock_data_enabled: boolean;
  updated_at: string;
}

export interface SourceHealthSnapshot {
  status: "ready" | "not_ready" | "stale";
  counts: {
    total: number;
    healthy: number;
    paused: number;
    circuit_open: number;
  };
  blocked_source_ids: string[];
  source_flags: string[];
}

export interface FlightDataRepository {
  getServiceState(): Promise<ServiceState>;
  getMapDeals(query: MapQuery): Promise<MapDeal[]>;
  getCalendarDeals(query: CalendarQuery): Promise<CalendarData>;
  getOffers(query: OffersQuery): Promise<OffersData>;
  getSearchResults(query: SearchQuery): Promise<SearchResult>;
  getSourceHealth(): Promise<SourceHealthSnapshot>;
}
