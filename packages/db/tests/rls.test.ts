import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTenantContext } from "../src/rls.js";
import { seedTwoMerchants, startTestDb, type TestDb } from "./setup.js";

let db: TestDb;
let merchantA: string;
let merchantB: string;

beforeAll(async () => {
  db = await startTestDb();
  const seeded = await seedTwoMerchants(db.sql);
  merchantA = seeded.merchantA;
  merchantB = seeded.merchantB;

  // Insert one customer for each merchant inside a transaction so the
  // tenant context (`SET LOCAL`) is guaranteed to live on the same
  // connection as the INSERT. Sequential awaits on `db.sql` may pick
  // different pool connections.
  await db.sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_merchant_id', ${merchantA}, true)`;
    await tx`
      INSERT INTO customers (merchant_id, telegram_id, full_name)
      VALUES (${merchantA}, 1001, 'Alice')
    `;
  });
  await db.sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_merchant_id', ${merchantB}, true)`;
    await tx`
      INSERT INTO customers (merchant_id, telegram_id, full_name)
      VALUES (${merchantB}, 2001, 'Bob')
    `;
  });
});

afterAll(async () => {
  await db.shutdown();
});

describe("RLS tenant isolation", () => {
  it("with merchant A context, only sees Alice", async () => {
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantA}, true)`;
      const rows = await tx`SELECT full_name FROM customers ORDER BY full_name`;
      expect(rows.length).toBe(1);
      expect(rows[0]!.full_name).toBe("Alice");
    });
  });

  it("with merchant B context, only sees Bob", async () => {
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantB}, true)`;
      const rows = await tx`SELECT full_name FROM customers ORDER BY full_name`;
      expect(rows.length).toBe(1);
      expect(rows[0]!.full_name).toBe("Bob");
    });
  });

  it("with empty context, sees no rows (deny by default)", async () => {
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', '', true)`;
      const rows = await tx`SELECT full_name FROM customers`;
      expect(rows.length).toBe(0);
    });
  });

  it("INSERT with mismatched merchant_id is rejected", async () => {
    await expect(
      db.sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_merchant_id', ${merchantA}, true)`;
        // Try to insert a customer claiming to belong to merchant B
        await tx`
          INSERT INTO customers (merchant_id, telegram_id, full_name)
          VALUES (${merchantB}, 9999, 'Mallory')
        `;
      }),
    ).rejects.toThrow();
  });

  it("UPDATE cannot touch rows of another merchant", async () => {
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantA}, true)`;
      const result = await tx`
        UPDATE customers SET full_name = 'Hacked' WHERE telegram_id = 2001
      `;
      // RLS hides the row from UPDATE; result.count should be 0
      expect(result.count).toBe(0);
    });

    // Verify Bob is untouched
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantB}, true)`;
      const rows = await tx`SELECT full_name FROM customers WHERE telegram_id = 2001`;
      expect(rows[0]!.full_name).toBe("Bob");
    });
  });

  it("DELETE cannot remove rows of another merchant", async () => {
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantA}, true)`;
      const result = await tx`DELETE FROM customers WHERE telegram_id = 2001`;
      expect(result.count).toBe(0);
    });

    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_merchant_id', ${merchantB}, true)`;
      const rows = await tx`SELECT count(*)::int AS n FROM customers`;
      expect(rows[0]!.n).toBe(1);
    });
  });

  it("setTenantContext helper enforces isolation end-to-end", async () => {
    // Smoke test that the public helper from rls.ts works through a Drizzle
    // transaction. The earlier 6 tests verify the policy semantics directly
    // against postgres-js; this test verifies the @lapakgram/db public export
    // path is wired correctly and the helper behaves as documented.
    //
    // We pass `schema` to drizzle() so the resulting transaction type matches
    // `LapakgramTx` (which `setTenantContext` requires); without it, drizzle's
    // tx is typed against an empty schema and TS rejects the call.
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { sql } = await import("drizzle-orm");
    const { schema } = await import("../src/index.js");
    const drizzleDb = drizzle(db.sql, { schema });

    const merchantANames = await drizzleDb.transaction(async (tx) => {
      await setTenantContext(tx, merchantA);
      const rows = await tx.execute<{ full_name: string }>(
        sql`SELECT full_name FROM customers ORDER BY full_name`,
      );
      // postgres-js + drizzle returns rows as an array directly.
      return (rows as unknown as { full_name: string }[]).map((r) => r.full_name);
    });
    expect(merchantANames).toEqual(["Alice"]);

    const merchantBNames = await drizzleDb.transaction(async (tx) => {
      await setTenantContext(tx, merchantB);
      const rows = await tx.execute<{ full_name: string }>(
        sql`SELECT full_name FROM customers ORDER BY full_name`,
      );
      return (rows as unknown as { full_name: string }[]).map((r) => r.full_name);
    });
    expect(merchantBNames).toEqual(["Bob"]);
  });
});
