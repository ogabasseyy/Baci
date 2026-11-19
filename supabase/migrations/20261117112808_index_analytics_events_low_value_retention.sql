-- disable-transaction
-- Build the partial retention index for low-value analytics events without blocking live writes.

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
      AND index_class.relname = 'analytics_events_low_value_retention_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.analytics_events_low_value_retention_idx;
  END IF;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_low_value_retention_idx
  ON public.analytics_events ((COALESCE(event_timestamp, created_at)))
  WHERE event_type IN ('page_view', 'search');
