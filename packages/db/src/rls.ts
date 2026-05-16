import { sql } from "drizzle-orm";
import type { LapakgramDb } from "./index.js";

/**
 * Drizzle's transaction callback parameter type. Extracted via a conditional
 * type because drizzle-orm doesn't export the transaction handle type for
 * postgres-js directly. The first argument to `db.transaction(fn)` is the
 * transaction object we want to type.
 */
type LapakgramTx = Parameters<LapakgramDb["transaction"]>[0] extends (tx: infer T) => unknown
  ? T
  : never;

/**
 * Set the current merchant tenant context for RLS-protected queries on this transaction.
 *
 * Pass a transaction handle (the `tx` argument from `db.transaction(async (tx) => ...)`).
 * The setting is transaction-local; it resets automatically when the transaction commits or rolls back.
 *
 * Usage:
 *   await db.transaction(async (tx) => {
 *     await setTenantContext(tx, merchantId);
 *     return tx.select().from(products);
 *   });
 *
 * The type signature requires a transaction handle to prevent silent no-ops
 * — calling `set_config(..., true)` outside a transaction does nothing,
 * which would silently bypass RLS.
 */
export async function setTenantContext(tx: LapakgramTx, merchantId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_merchant_id', ${merchantId}, true)`);
}

/**
 * Clears the merchant tenant context (sets the GUC to empty string).
 *
 * The `tenant_isolation` policy treats empty-string as deny-all. Primarily
 * used in tests to verify the deny-by-default path. App code rarely calls
 * this; the txn-local config resets automatically at transaction end.
 */
export async function clearTenantContext(tx: LapakgramTx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_merchant_id', '', true)`);
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
