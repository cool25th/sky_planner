import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

export function migrationDatabaseUrl(env = process.env) {
  if (env.DATABASE_MIGRATION_URL) return env.DATABASE_MIGRATION_URL;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  return "";
}

export async function runMigrations(options = {}) {
  const connectionString = options.connectionString ?? migrationDatabaseUrl(options.env);
  if (!connectionString) {
    throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required to run migrations");
  }
  const sqlDir = options.sqlDir ?? path.join(process.cwd(), "sql", "init");
  const files = (await readdir(sqlDir)).filter((name) => name.endsWith(".sql")).sort();
  if (!files.length) throw new Error(`No migration SQL files found in ${sqlDir}`);

  const client = new (options.Client ?? pg.Client)({ connectionString });
  await client.connect();
  const applied = [];
  try {
    for (const file of files) {
      const sql = await readFile(path.join(sqlDir, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration failed: ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await client.end();
  }
  return { status: "applied", applied, count: applied.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((err) => {
      console.error("Postgres migration failed.");
      console.error(err);
      process.exit(1);
    });
}
