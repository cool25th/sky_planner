import "server-only";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_READ_URL or DATABASE_URL environment variable is not defined. Please check your configuration."
    );
  }

  pool = new Pool({
    connectionString,
    max: 10, // Limit connection pool size for Hobby/dev environments
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client", err);
  });

  return pool;
}

// Neon autosuspend(무료 티어 ~5분 유휴 후 compute 중지) 콜드스타트에서 첫 연결이
// connectionTimeoutMillis(5s)를 넘어 실측 503 발생(2026-09-06). BFF는 read 롤 SELECT
// 전용(ADR-006)이라 동일 쿼리 1회 재시행이 안전하다.
const RETRYABLE_CONNECTION_CODES = new Set([
  "CONNECTION_TIMEOUT",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
]);
const RETRYABLE_CONNECTION_MESSAGE = /connection terminated|connection ended|server closed the connection/i;

export function isRetryableConnectionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && RETRYABLE_CONNECTION_CODES.has(code)) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && RETRYABLE_CONNECTION_MESSAGE.test(message);
}

export async function withConnectionRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isRetryableConnectionError(err)) throw err;
    return run();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return withConnectionRetry(() => getDbPool().query<T>(text, params));
}
