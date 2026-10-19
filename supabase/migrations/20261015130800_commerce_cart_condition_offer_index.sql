-- disable-transaction
-- Build the new order-item pool lineage index without blocking ordinary writes.

-- Recover an invalid concurrent index left behind by an interrupted build.
-- CREATE INDEX CONCURRENTLY ... IF NOT EXISTS treats an invalid same-named
-- index as present, so remove only that artifact before retrying the build.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'order_items_product_offer_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.order_items_product_offer_idx;
  END IF;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS order_items_product_offer_idx
  ON public.order_items (product_offer_id);

COMMENT ON INDEX public.order_items_product_offer_idx IS
  'Supports durable condition-offer lineage checks and inventory restoration.';
