import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isHiddenFare } from "./fare-freshness.ts";
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

function normalizeBatchState(data: unknown): BatchState | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return {
    generatedAt: String(record.generated_at ?? record.generatedAt ?? GENERATED_AT),
    lastBatchAt: String(record.last_batch_at ?? record.lastBatchAt ?? DEFAULT_LAST_BATCH_AT),
    sourceFlags: normalizeSourceFlags(record.source_flags ?? record.sourceFlags),
  };
}

async function getPostgresBatchState(): Promise<BatchState | null> {
  // lib/db와 동일한 우선순위: BFF는 READ_URL만 가지는 경우가 운영 표준이다.
  const connectionString = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;

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
    const state = normalizeBatchState(JSON.parse(raw));
    // 72시간 정책: 오래된 배치 기록을 데모 폴백에 그대로 싣지 않고 롤링 기본값으로 떨어뜨린다.
    if (!state || isHiddenFare(state.lastBatchAt)) return null;
    return state;
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
