-- Enable RLS and define tenant_isolation policy on every tenant-scoped table.
-- Policy: SELECT/UPDATE/DELETE/INSERT only succeed when the row's merchant_id
-- matches the session GUC `app.current_merchant_id`. If the GUC is empty
-- string (or unset, which `current_setting(..., true)` returns as NULL),
-- NO rows match (deny by default).
--
-- Implementation note: we use `NULLIF(..., '')::uuid` rather than guarding
-- the cast with an explicit `<> ''` check joined by AND. PostgreSQL does not
-- guarantee short-circuit evaluation of AND in policy expressions; the
-- planner can constant-fold the (stable) `current_setting()` calls and
-- evaluate the `::uuid` cast eagerly, which raises `invalid input syntax`
-- when the GUC is empty. `NULLIF` makes the unset/empty case yield NULL
-- before the cast runs, and `merchant_id = NULL` is NULL (treated as false
-- by USING/WITH CHECK), giving the intended deny-by-default behavior.

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
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

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
