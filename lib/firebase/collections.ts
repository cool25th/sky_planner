export const COLLECTIONS = {
  SERVICE_STATE: "service_state",
  SOURCE_STATE: "source_state",
  SOURCE_JOBS: "source_jobs",
  BATCHES: "batches",
  CURRENT_VIEWS: "current_views",
  OFFERS: "offers",
} as const;

export function formatMapViewId(origin: string, week: string, stayBucket: string, cabin: string): string {
  return `map__${origin}__${week}__${stayBucket}__${cabin}`;
}

export function formatCalendarViewId(origin: string, destination: string, month: string, cabin: string): string {
  return `calendar__${origin}__${destination}__${month}__${cabin}`;
}
