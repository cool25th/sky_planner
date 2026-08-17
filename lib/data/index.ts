import "server-only";

import type { FlightDataRepository } from "./repository";
import { MockRepository } from "./mock-repository";
import { FirestoreRepository } from "./firestore-repository";

let repositoryInstance: FlightDataRepository | null = null;

export function getFlightDataRepository(): FlightDataRepository {
  if (repositoryInstance) return repositoryInstance;

  const backend = process.env.DATA_BACKEND;
  if (backend === "firestore" || process.env.SERVICE_REQUIRE_FIRESTORE === "true") {
    repositoryInstance = new FirestoreRepository();
  } else {
    repositoryInstance = new MockRepository();
  }

  return repositoryInstance;
}

export * from "./repository";
export * from "./mock-repository";
export * from "./firestore-repository";
