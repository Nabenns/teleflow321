import { sql } from "drizzle-orm";
import type { LapakgramDb } from "./index.js";

/**
 * Drizzle's transaction callback parameter type. Extracted via a conditional
 * type because drizzle-orm doesn't export the transaction handle type for
 * postgres-js directly. The first argument to `db.transaction(fn)` is the
 * transaction object we want to type.
 */
type LapakgramTx = Parameters<LapakgramDb["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

/**
 * Set the current merchant tenant context for RLS-protected queries.
 * MUST be called inside a transaction; the setting is local and resets at
 * txn end (`set_config(..., true)` writes a transaction-local GUC).
 *
 * Usage:
 *   await db.transaction(async (tx) => {
 *     await setTenantContext(tx, merchantId);
 *     return tx.select().from(products);
 *   });
 */
export async function setTenantContext(
  db: LapakgramDb | LapakgramTx,
  merchantId: string,
): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.current_merchant_id', ${merchantId}, true)`,
  );
}

/**
 * Reset the tenant context to an empty string. With the `tenant_isolation`
 * policy, an empty GUC denies all rows (deny by default). Useful between
 * statements within a transaction to scope a sub-query to "no tenant".
 */
export async function clearTenantContext(
  db: LapakgramDb | LapakgramTx,
): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.current_merchant_id', '', true)`,
  );
}

/**
 * Tenant-scoped tables that have RLS enabled with the `tenant_isolation`
 * policy. Kept in sync with `migrations/0002_rls_policies.sql` and used by
 * the RLS isolation tests (Task 9).
 */
export const TENANT_TABLES = [
  "customers",
  "product_categories",
  "products",
  "product_stocks",
  "product_files",
  "vouchers",
  "orders",
  "order_items",
  "balance_topups",
  "balance_transactions",
  "complaints",
  "merchant_payouts",
  "merchant_balances",
  "audit_logs",
] as const;
