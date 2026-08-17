import admin from "firebase-admin";
import { COLLECTIONS } from "../lib/firebase/collections.ts";

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

export async function cleanupOldBatches(options = {}) {
  const keepCount = options.keep || 2;
  const isDryRun = options.dryRun || false;

  const app = initFirebase();
  const db = app.firestore();

  const batchesSnapshot = await db
    .collection(COLLECTIONS.BATCHES)
    .orderBy("published_at", "desc")
    .get();

  const allBatches = [];
  batchesSnapshot.forEach((doc) => {
    allBatches.push({ id: doc.id, ...doc.data() });
  });

  const batchesToKeep = allBatches.slice(0, keepCount).map((b) => b.id);
  const batchesToDelete = allBatches.slice(keepCount).map((b) => b.id);

  if (batchesToDelete.length === 0) {
    return {
      status: "noop",
      retained_batches: batchesToKeep,
      deleted_batches: [],
      deleted_doc_count: 0,
    };
  }

  let deletedDocCount = 0;

  for (const batchId of batchesToDelete) {
    // 1. Delete offers belonging to this batch
    const offersSnapshot = await db
      .collection(COLLECTIONS.OFFERS)
      .where("batch_id", "==", batchId)
      .limit(500)
      .get();

    if (!isDryRun) {
      const batchOp = db.batch();
      offersSnapshot.forEach((doc) => {
        batchOp.delete(doc.ref);
        deletedDocCount++;
      });
      // Delete batch doc
      batchOp.delete(db.collection(COLLECTIONS.BATCHES).doc(batchId));
      deletedDocCount++;
      await batchOp.commit();
    } else {
      deletedDocCount += offersSnapshot.size + 1;
    }
  }

  return {
    status: isDryRun ? "dry_run" : "cleaned",
    retained_batches: batchesToKeep,
    deleted_batches: batchesToDelete,
    deleted_doc_count: deletedDocCount,
  };
}

async function main() {
  const keepArg = process.argv.indexOf("--keep");
  const keep = keepArg !== -1 ? parseInt(process.argv[keepArg + 1], 10) : 2;
  const isDryRun = process.argv.includes("--dry-run");

  const result = await cleanupOldBatches({ keep, dryRun: isDryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
}
