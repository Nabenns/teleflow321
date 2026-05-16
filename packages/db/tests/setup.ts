import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

export interface TestDb {
  url: string;
  container: StartedPostgreSqlContainer;
  sql: ReturnType<typeof postgres>;
  shutdown: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("lapakgram_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  // Apply migrations as the bootstrap `test` user. testcontainers provisions
  // `test` as a SUPERUSER, and superusers ALWAYS bypass RLS (even with FORCE
  // ROW LEVEL SECURITY). After migrations apply, we create a non-superuser
  // `app_user` role; the application pool connects as that role so the RLS
  // policies actually run, mirroring how a real production role behaves.
  const adminUrl = container.getConnectionUri();
  const adminSql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const dir = fileURLToPath(new URL("../migrations", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const path = join(dir, file);
    const stmt = readFileSync(path, "utf8");
    await adminSql.unsafe(stmt);
  }

  // Create a plain LOGIN role with no special attributes. It must own no
  // tenant tables and must not be a superuser, otherwise RLS would not
  // apply to it.
  await adminSql.unsafe(`
    DO $$ BEGIN
      CREATE ROLE app_user LOGIN PASSWORD 'app_user';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  `);
  await adminSql.end({ timeout: 5 });

  // Build the app-user connection URL from the container metadata. We can't
  // just patch the admin URL because it embeds `test:test`.
  const url = `postgres://app_user:app_user@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const sql = postgres(url, { max: 5, onnotice: () => {} });

  return {
    url,
    container,
    sql,
    shutdown: async () => {
      await sql.end({ timeout: 5 });
      await container.stop();
    },
  };
}

export async function seedTwoMerchants(sql: TestDb["sql"]) {
  const [planA] = await sql`
    INSERT INTO plans (code, name) VALUES ('test', 'Test Plan')
    RETURNING id
  `;
  const planId = planA!.id as string;

  const [m1] = await sql`
    INSERT INTO merchants (slug, name, plan_id, status)
    VALUES ('shop-a', 'Shop A', ${planId}, 'active')
    RETURNING id
  `;
  const [m2] = await sql`
    INSERT INTO merchants (slug, name, plan_id, status)
    VALUES ('shop-b', 'Shop B', ${planId}, 'active')
    RETURNING id
  `;

  return {
    merchantA: m1!.id as string,
    merchantB: m2!.id as string,
  };
}
