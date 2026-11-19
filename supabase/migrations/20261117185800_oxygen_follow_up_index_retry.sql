-- disable-transaction
-- Build before the validating migration so a failed concurrent build retries
-- this same migration and can remove its own invalid artifact first.
DO $cleanup$
DECLARE existing record;
BEGIN
  SELECT i.indisvalid, i.indisready, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
    INTO existing
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_orders_oxygen_follow_up_merchant_created');
  IF FOUND AND (NOT existing.indisvalid OR NOT existing.indisready) THEN
    IF existing.definition IS DISTINCT FROM
      'CREATE INDEX idx_orders_oxygen_follow_up_merchant_created ON public.orders USING btree (merchant_id, created_at DESC) WHERE (payment_method = ''oxygen''::text)' THEN
      RAISE EXCEPTION 'Invalid Oxygen follow-up index does not match expected definition';
    END IF;
    -- Invalid indexes do not serve reads. Bound the brief lock required for
    -- transactional DROP INDEX; never wait indefinitely on a busy orders table.
    PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
    DROP INDEX public.idx_orders_oxygen_follow_up_merchant_created;
  END IF;
END;
$cleanup$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_oxygen_follow_up_merchant_created
  ON public.orders (merchant_id, created_at DESC)
  WHERE payment_method = 'oxygen';
