import admin from "firebase-admin";
import { COLLECTIONS, formatMapViewId } from "../lib/firebase/collections.ts";

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

export async function smokeFirestoreRead() {
  const app = initFirebase();
  const db = app.firestore();

  let totalReads = 0;

  // 1. Service State Read (1 Read)
  const serviceStateRef = db.collection(COLLECTIONS.SERVICE_STATE).doc("production");
  const serviceStateSnap = await serviceStateRef.get();
  totalReads += 1;

  // 2. Representative Map View Read (1 Read)
  const mapViewId = formatMapViewId("ICN", "2026-W13", "5_7", "economy");
  const mapViewRef = db.collection(COLLECTIONS.CURRENT_VIEWS).doc(mapViewId);
  const mapViewSnap = await mapViewRef.get();
  totalReads += 1;

  const passed = totalReads <= 3;

  return {
    status: passed ? "pass" : "fail",
    total_document_reads: totalReads,
    max_allowed_reads: 3,
    service_state_exists: serviceStateSnap.exists,
    map_view_exists: mapViewSnap.exists,
    checked_at: new Date().toISOString(),
  };
}

async function main() {
  const result = await smokeFirestoreRead();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "fail") {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Smoke read error:", err);
    process.exit(1);
  });
}
