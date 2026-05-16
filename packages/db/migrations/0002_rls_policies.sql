-- Enable RLS and define tenant_isolation policy on every tenant-scoped table.
-- Policy: SELECT/UPDATE/DELETE/INSERT only succeed when the row's merchant_id
-- matches the session GUC `app.current_merchant_id`. If the GUC is empty
-- string (or unset, which `current_setting(..., true)` returns as NULL),
-- NO rows match (deny by default).

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
           merchant_id::text = current_setting(''app.current_merchant_id'', true)
           AND current_setting(''app.current_merchant_id'', true) <> ''''
         )
         WITH CHECK (
           merchant_id::text = current_setting(''app.current_merchant_id'', true)
           AND current_setting(''app.current_merchant_id'', true) <> ''''
         )',
      t
    );
  END LOOP;
END $$;
