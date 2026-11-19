-- disable-transaction
-- Keep the orphaned Oxygen checkout lookup bounded without blocking order writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_oxygen_follow_up_merchant_created
  ON public.orders (merchant_id, created_at DESC)
  WHERE payment_method = 'oxygen';

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO definition
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_orders_oxygen_follow_up_merchant_created')
    AND i.indisvalid AND i.indisready;
  IF definition IS DISTINCT FROM
    'CREATE INDEX idx_orders_oxygen_follow_up_merchant_created ON public.orders USING btree (merchant_id, created_at DESC) WHERE (payment_method = ''oxygen''::text)' THEN
    RAISE EXCEPTION 'Oxygen follow-up index missing, invalid or changed: %', definition;
  END IF;
END $$;
