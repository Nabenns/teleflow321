-- Re-create the tenant_isolation policy on every tenant table using the
-- NULLIF(..., '')::uuid form. Migration 0002 originally shipped with an
-- AND-guarded cast that the Postgres planner could constant-fold and
-- evaluate eagerly, raising 'invalid input syntax' on empty GUC. The 0002
-- file was rewritten in-place when that bug was caught, but drizzle's
-- migration tracker uses the tag/name (not content hash) to gate replay,
-- so dev databases initialized before that fix still carry the old policy
-- form. This migration converges them to the safe form regardless of the
-- order developers ran prior migrations.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'customers',
    'product_categories',
    'products',
    'product_stocks',
    'product_files',
    'vouchers',
    'orders',
    'order_items',
    'balance_topups',
    'balance_transactions',
    'complaints',
    'merchant_payouts',
    'merchant_balances',
    'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (
           merchant_id = NULLIF(current_setting(''app.current_merchant_id'', true), '''')::uuid
         )
         WITH CHECK (
           merchant_id = NULLIF(current_setting(''app.current_merchant_id'', true), '''')::uuid
         )',
      t
    );
  END LOOP;
END $$;
