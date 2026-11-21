-- disable-transaction
-- Partial index that holds only analytics_events rows still carrying the
-- visitor user agent, so the retention scrub finds old rows without scanning
-- the whole table. Built concurrently so live event writes are not blocked.

-- Recover an invalid concurrent index left behind by an interrupted build.
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
      AND index_class.relname = 'analytics_events_user_agent_scrub_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX IF EXISTS public.analytics_events_user_agent_scrub_idx;
  END IF;
END;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_user_agent_scrub_idx
  ON public.analytics_events (created_at)
  WHERE pg_catalog.jsonb_typeof(event_data) = 'object' AND event_data ? 'user_agent';
