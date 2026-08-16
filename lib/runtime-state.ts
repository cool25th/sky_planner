import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ACTIVE_SOURCE_FLAGS, DEFAULT_LAST_BATCH_AT, GENERATED_AT } from "./mock-market";

const runtimeDir = join(process.cwd(), "runtime");
const batchStatePath = join(runtimeDir, "batch-state.json");

export interface BatchState {
  generatedAt: string;
  lastBatchAt: string;
  sourceFlags: string[];
}

function normalizeSourceFlags(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [...ACTIVE_SOURCE_FLAGS];
}

function normalizeBatchState(data: any): BatchState | null {
  if (!data || typeof data !== "object") return null;
  return {
    generatedAt: String(data.generated_at ?? data.generatedAt ?? GENERATED_AT),
    lastBatchAt: String(data.last_batch_at ?? data.lastBatchAt ?? DEFAULT_LAST_BATCH_AT),
    sourceFlags: normalizeSourceFlags(data.source_flags ?? data.sourceFlags),
  };
}

async function getPostgresBatchState(): Promise<BatchState | null> {
  if (!process.env.DATABASE_URL) return null;

  try {
    const { query } = await import("./db");
    const { rows } = await query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1");
    return normalizeBatchState(rows[0]?.data);
  } catch (err) {
    console.error("Failed to fetch batch state from PostgreSQL, using runtime file fallback.", err);
    return null;
  }
}

async function getFileBatchState(): Promise<BatchState | null> {
  try {
    const raw = await readFile(batchStatePath, "utf-8");
    return normalizeBatchState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function getBatchState(): Promise<BatchState> {
  return (
    await getPostgresBatchState() ??
    await getFileBatchState() ??
    {
      generatedAt: GENERATED_AT,
      lastBatchAt: DEFAULT_LAST_BATCH_AT,
      sourceFlags: [...ACTIVE_SOURCE_FLAGS],
    }
  );
}
