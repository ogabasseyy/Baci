-- disable-transaction
-- The public repair-booking RPC bounds abuse by a merchant, normalized email,
-- and recent creation time. Keep that count index-backed as repair history grows.

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
      AND index_class.relname = 'repairs_merchant_normalized_email_created_at_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.repairs_merchant_normalized_email_created_at_idx;
  END IF;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS repairs_merchant_normalized_email_created_at_idx
  ON public.repairs (merchant_id, lower(btrim(customer_email)), created_at);

COMMENT ON INDEX public.repairs_merchant_normalized_email_created_at_idx IS
  'Supports the per-email one-hour abuse limit in private.create_repair_booking.';
