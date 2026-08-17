import admin from "firebase-admin";

let app: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (app) return app;

  if (admin.apps.length > 0) {
    app = admin.apps[0]!;
    return app;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // If emulator is configured or running locally without explicit credentials
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    app = admin.initializeApp({
      projectId: projectId || "sky-planner-dev",
    });
    return app;
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)."
    );
  }

  // Handle escaped newlines in private key
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  return app;
}

export function getFirestore(): admin.firestore.Firestore {
  const adminApp = getFirebaseAdmin();
  const db = adminApp.firestore();
  return db;
}
