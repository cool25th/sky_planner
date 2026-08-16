import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runtimeDir = join(process.cwd(), "runtime");
const batchStatePath = join(runtimeDir, "batch-state.json");
const manifestPath = join(runtimeDir, "offer-hashes.json");

const batchState = {
  generatedAt: "2026-03-24T11:30",
  lastBatchAt: new Date().toISOString().slice(0, 16),
  sourceFlags: ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
};

const manifest = {
  generatedAt: batchState.generatedAt,
  lastBatchAt: batchState.lastBatchAt,
  note: "local mock batch manifest",
};

await mkdir(runtimeDir, { recursive: true });
await writeFile(batchStatePath, JSON.stringify(batchState, null, 2));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({ batchState, manifest }, null, 2));
