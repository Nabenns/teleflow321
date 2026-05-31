import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import postgres from "postgres";

const ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://lapakgram:lapakgram_dev@localhost:5434/postgres";

// Arbitrary 64-bit key for cross-worker serialization. Vitest runs each test
// file in a separate worker; without locking, multiple workers race on
// CREATE/DROP DATABASE and trip pg_database_datname_index. The advisory lock
// is session-scoped, so it auto-releases if a worker crashes.
// Magic number: 0x1A_06_BE_EF chosen as a recognizable signature in pg locks.
const BOOTSTRAP_LOCK_KEY = 0x1a06beef;

export async function ensureTestDb(testDbName: string): Promise<string> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin`SELECT pg_advisory_lock(${BOOTSTRAP_LOCK_KEY})`;

    const [existing] = await admin<{ exists: boolean }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${testDbName}
    `;

    if (!existing) {
      await admin.unsafe(`CREATE DATABASE ${testDbName}`);
      const dbUrl = ADMIN_URL.replace(/\/postgres$/, `/${testDbName}`);
      const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
      const dir = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of files) {
        const sqlText = readFileSync(join(dir, file), "utf8");
        await sql.unsafe(sqlText);
      }
      await sql.end({ timeout: 5 });
    }
  } finally {
    await admin`SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_KEY})`;
    await admin.end({ timeout: 5 });
  }

  return ADMIN_URL.replace(/\/postgres$/, `/${testDbName}`);
}
