import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import admin from "firebase-admin";
import { calculateEstimatedWrites, validateWriteQuota } from "../lib/quota/guard.ts";
import { COLLECTIONS, formatMapViewId, formatCalendarViewId } from "../lib/firebase/collections.ts";

function initFirebase() {
  if (admin.apps.length > 0) return admin.apps[0];
  const projectId = process.env.FIREBASE_PROJECT_ID || "sky-planner-dev";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return admin.initializeApp({ projectId });
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)");
  }

  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

export async function publishFirestoreBatch(batchJsonPath, options = {}) {
  const rawData = await readFile(batchJsonPath, "utf-8");
  const batch = JSON.parse(rawData);

  const app = initFirebase();
  const db = app.firestore();

  // 1. Pre-aggregate Map Views and Offers
  const mapViews = new Map();
  const calendarViews = new Map();
  const topOffers = [];

  for (const offer of batch.offers || []) {
    const origin = offer.origin_airport || "ICN";
    const week = offer.week || "2026-W13";
    const stayBucket = "5_7";
    const cabin = offer.cabin_group || "economy";

    // Map View
    const mapViewId = formatMapViewId(origin, week, stayBucket, cabin);
    if (!mapViews.has(mapViewId)) {
      mapViews.set(mapViewId, {
        view_id: mapViewId,
        view_type: "map",
        origin,
        week,
        stay_bucket: stayBucket,
        cabin,
        batch_id: batch.execution_id,
        deals: [],
        published_at: new Date().toISOString(),
      });
    }

    const view = mapViews.get(mapViewId);
    const existingDeal = view.deals.find((d) => d.destination_code === offer.destination_city_id);
    if (!existingDeal) {
      view.deals.push({
        destination_code: offer.destination_city_id,
        city: offer.destination_display_name || offer.destination_city_id,
        country: offer.country_code,
        lat: offer.latitude || 35.0,
        lon: offer.longitude || 135.0,
        region: offer.region || "ASIA",
        economy_min_total: cabin === "economy" ? offer.total_price : null,
        business_min_total: cabin === "business" ? offer.total_price : null,
        best_airline: offer.airline_name,
        best_offer_id: offer.offer_id,
      });
    }

    // Top Offers (store top 3 per destination)
    topOffers.push({
      offer_id: offer.offer_id,
      batch_id: batch.execution_id,
      origin_airport: offer.origin_airport,
      destination_airport: offer.destination_airport,
      destination_city_id: offer.destination_city_id,
      depart_date: offer.depart_date,
      return_date: offer.return_date,
      airline_code: offer.airline_code,
      airline_name: offer.airline_name,
      cabin_group: offer.cabin_group,
      total_price: offer.total_price,
      currency: offer.currency || "KRW",
      deep_link: offer.deep_link,
      booking_source: offer.booking_source,
      price_status: offer.price_status || "active",
      observed_at: batch.collected_at,
    });
  }

  // 2. Validate Quota Budget
  const budget = calculateEstimatedWrites({
    sourceCount: 1,
    viewCount: mapViews.size + calendarViews.size,
    offerCount: topOffers.length,
  });

  const quotaCheck = validateWriteQuota(budget);
  if (!quotaCheck.ok && !options.force) {
    throw new Error(`Write Quota Violation: ${quotaCheck.reason}`);
  }

  if (options.dryRun) {
    return { status: "validated", budget, map_views: mapViews.size, offers: topOffers.length };
  }

  // 3. Write Batch & Chunks
  const batchRef = db.collection(COLLECTIONS.BATCHES).doc(batch.execution_id);
  await batchRef.set({
    batch_id: batch.execution_id,
    schema_version: batch.schema_version,
    source_id: batch.source_id,
    collected_at: batch.collected_at,
    published_at: new Date().toISOString(),
    offer_count: topOffers.length,
    view_count: mapViews.size,
  });

  // Write Map Views
  const writePromises = [];
  for (const [viewId, viewData] of mapViews.entries()) {
    writePromises.push(db.collection(COLLECTIONS.CURRENT_VIEWS).doc(viewId).set(viewData));
  }

  // Write Top Offers
  for (const offer of topOffers) {
    writePromises.push(db.collection(COLLECTIONS.OFFERS).doc(offer.offer_id).set(offer));
  }

  await Promise.all(writePromises);

  // 4. Atomic Pointer Swap on service_state/production
  const serviceStateRef = db.collection(COLLECTIONS.SERVICE_STATE).doc("production");
  const prevDoc = await serviceStateRef.get();
  const prevBatchId = prevDoc.exists ? prevDoc.data()?.current_batch_id : null;

  await serviceStateRef.set({
    environment: "beta",
    release_version: "1.0.0",
    current_batch_id: batch.execution_id,
    previous_batch_id: prevBatchId || null,
    last_successful_publish_at: new Date().toISOString(),
    data_status: "ready",
    active_source_ids: [batch.source_id],
    estimated_daily_writes: budget.total_writes,
    mock_data_enabled: false,
    updated_at: new Date().toISOString(),
  });

  return {
    status: "published",
    current_batch_id: batch.execution_id,
    previous_batch_id: prevBatchId,
    total_writes: budget.total_writes,
  };
}

async function main() {
  const inputArg = process.argv.indexOf("--input");
  const inputPath = inputArg !== -1 ? process.argv[inputArg + 1] : "tests/fixtures/collector-batch.sample.json";
  const isDryRun = process.argv.includes("--dry-run");

  const result = await publishFirestoreBatch(inputPath, { dryRun: isDryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Publish failed:", err);
    process.exit(1);
  });
}
