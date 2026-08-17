import {
  type CalendarData,
  type CalendarQuery,
  type MapDeal,
  type MapQuery,
  type Offer,
  type OffersData,
  type OffersQuery,
  type SearchQuery,
  type SearchResult,
  getSearchResults,
} from "../mock-market.ts";
import { getFirestore } from "../firebase/admin.ts";
import { COLLECTIONS, formatCalendarViewId, formatMapViewId } from "../firebase/collections.ts";
import type { FlightDataRepository, ServiceState, SourceHealthSnapshot } from "./repository.ts";

export class FirestoreRepository implements FlightDataRepository {
  async getServiceState(): Promise<ServiceState> {
    const db = getFirestore();
    const docSnap = await db.collection(COLLECTIONS.SERVICE_STATE).doc("production").get();
    if (!docSnap.exists) {
      throw new Error("Firestore document service_state/production not found");
    }
    return docSnap.data() as ServiceState;
  }

  async getMapDeals(query: MapQuery): Promise<MapDeal[]> {
    const db = getFirestore();
    const viewId = formatMapViewId(query.origin, query.week, query.stay_bucket, query.cabin);
    const docSnap = await db.collection(COLLECTIONS.CURRENT_VIEWS).doc(viewId).get();

    if (!docSnap.exists) {
      return [];
    }

    const data = docSnap.data();
    return (data?.deals as MapDeal[]) || [];
  }

  async getCalendarDeals(query: CalendarQuery): Promise<CalendarData> {
    const db = getFirestore();
    const month = query.week ? query.week.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const viewId = formatCalendarViewId(query.origin, query.destination, month, query.cabin);
    const docSnap = await db.collection(COLLECTIONS.CURRENT_VIEWS).doc(viewId).get();

    if (!docSnap.exists) {
      return {
        origin: query.origin,
        week: query.week || "2026-W13",
        stay_bucket: query.stay_bucket || "5_7",
        traveler: query.traveler || "adt1",
        destination: null,
        departure_dates: [],
        return_dates: [],
        cells: [],
        available_airlines: [],
      };
    }

    return docSnap.data() as CalendarData;
  }

  async getOffers(query: OffersQuery): Promise<OffersData> {
    const db = getFirestore();
    // Optimized single collection query: fetch top offers for destination & dates
    const snapshot = await db
      .collection(COLLECTIONS.OFFERS)
      .where("origin_airport", "==", query.origin)
      .where("destination_airport", "==", query.destination)
      .where("depart_date", "==", query.depart)
      .where("return_date", "==", query.return)
      .limit(10)
      .get();

    const offers: Offer[] = [];
    snapshot.forEach((doc) => {
      offers.push(doc.data() as Offer);
    });

    return {
      origin: query.origin,
      week: query.week || "2026-W13",
      traveler: query.traveler || "adt1",
      destination: query.destination,
      depart: query.depart,
      return: query.return,
      offers,
      filters: {
        available_airlines: [],
        available_cabins: [],
        available_stops: [0, 1],
      },
      summary: {
        count: offers.length,
        lowest_total: offers[0]?.price_total ?? null,
        last_seen_at: offers[0]?.last_seen_at ?? new Date().toISOString(),
      },
    };
  }

  async getSearchResults(query: SearchQuery): Promise<SearchResult> {
    return getSearchResults(query);
  }

  async getSourceHealth(): Promise<SourceHealthSnapshot> {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.SOURCE_STATE).get();

    let total = 0;
    let healthy = 0;
    let paused = 0;
    let circuit_open = 0;
    const blocked_source_ids: string[] = [];
    const source_flags: string[] = [];

    snapshot.forEach((doc) => {
      total += 1;
      const data = doc.data();
      const sId = doc.id;
      if (data.circuit_state === "open") {
        circuit_open += 1;
        blocked_source_ids.push(sId);
      } else if (data.enabled === false) {
        paused += 1;
        blocked_source_ids.push(sId);
      } else {
        healthy += 1;
        source_flags.push(sId);
      }
    });

    return {
      status: healthy >= 1 ? "ready" : "not_ready",
      counts: {
        total,
        healthy,
        paused,
        circuit_open,
      },
      blocked_source_ids,
      source_flags,
    };
  }
}
