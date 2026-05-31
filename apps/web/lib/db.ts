import { createDb, type LapakgramDb } from "@lapakgram/db";

// Memoized per-URL DB pool shared across server components and server actions.
// Server components run per-request; without this, each request spawns a fresh
// postgres-js pool (max 10) that lingers until idle-timeout and exhausts
// Postgres connections under load.
let cached: { url: string; db: LapakgramDb } | null = null;

export function getDb(): LapakgramDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  if (cached?.url === url) return cached.db;
  cached = { url, db: createDb(url) };
  return cached.db;
}
