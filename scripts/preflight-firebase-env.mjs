import { z } from "zod";

const FirebaseEnvSchema = z.object({
  APP_ENV: z.string().default("beta"),
  DATA_BACKEND: z.literal("firestore"),
  SERVICE_REQUIRE_FIRESTORE: z.literal("true"),
  FIREBASE_PROJECT_ID: z.string().min(3),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(20),
  FIRESTORE_MAX_DAILY_READS: z.coerce.number().max(30000).default(30000),
  FIRESTORE_MAX_DAILY_WRITES: z.coerce.number().max(12000).default(12000),
  FIRESTORE_MAX_STORAGE_MB: z.coerce.number().max(600).default(600),
  MOCK_DATA_ENABLED: z.literal("false").default("false"),
});

export function checkFirebaseEnv(env = process.env) {
  const isEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (isEmulator) {
    return { status: "pass", mode: "emulator", message: "Running with Firebase Emulator" };
  }

  const result = FirebaseEnvSchema.safeParse(env);
  if (!result.success) {
    return {
      status: "fail",
      errors: result.error.flatten().fieldErrors,
    };
  }

  return { status: "pass", mode: "spark_production", config: { projectId: result.data.FIREBASE_PROJECT_ID } };
}

function main() {
  const result = checkFirebaseEnv();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "fail") {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
