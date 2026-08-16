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

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const dbPool = getDbPool();
  return dbPool.query<T>(text, params);
}
