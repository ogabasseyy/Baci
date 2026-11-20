CREATE OR REPLACE FUNCTION public.cleanup_database_retention(
  p_analytics_low_value_retention interval DEFAULT interval '30 days',
  p_cron_retention interval DEFAULT interval '14 days',
  p_pg_net_retention interval DEFAULT interval '1 day'
)
RETURNS TABLE (
  analytics_events_deleted bigint,
  cron_job_run_details_deleted bigint,
  pg_net_responses_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_personal_data_retention CONSTANT interval := interval '90 days';
  v_batch_size integer := 2000;
  v_max_batches_per_table integer := 10;
  v_table_budget interval := interval '2 seconds';
  v_now timestamptz;
  v_analytics_cutoff timestamptz;
  v_cron_cutoff timestamptz;
  v_pg_net_cutoff timestamptz;
  v_table_started_at timestamptz;
  v_batches integer;
  v_batch_deleted bigint;
  v_scrub_batch_size CONSTANT integer := 10000;
  v_scrub_deadline timestamptz;
  v_scrub_cutoff timestamptz;
  v_scrubbed bigint;
BEGIN
  v_now := pg_catalog.clock_timestamp();
  v_analytics_cutoff :=
    v_now - COALESCE(p_analytics_low_value_retention, interval '30 days');
  v_cron_cutoff :=
    v_now - COALESCE(p_cron_retention, interval '14 days');
  v_pg_net_cutoff :=
    v_now - COALESCE(p_pg_net_retention, interval '1 day');

  analytics_events_deleted := 0;
  cron_job_run_details_deleted := 0;
  pg_net_responses_deleted := 0;

  v_table_started_at := pg_catalog.clock_timestamp();
  v_batches := 0;
  LOOP
    EXIT WHEN v_batches >= v_max_batches_per_table;
    EXIT WHEN v_batches > 0
      AND pg_catalog.clock_timestamp() - v_table_started_at >= v_table_budget;

    WITH batch AS (
      SELECT events.ctid AS row_ctid
      FROM public.analytics_events AS events
      WHERE events.event_type IN ('page_view', 'search')
        AND COALESCE(events.event_timestamp, events.created_at) < v_analytics_cutoff
      LIMIT v_batch_size
    )
    DELETE FROM public.analytics_events AS target
    USING batch
    WHERE target.ctid = batch.row_ctid;

    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    analytics_events_deleted := analytics_events_deleted + v_batch_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_batch_deleted < v_batch_size;
  END LOOP;

  v_table_started_at := pg_catalog.clock_timestamp();
  v_batches := 0;
  LOOP
    EXIT WHEN v_batches >= v_max_batches_per_table;
    EXIT WHEN v_batches > 0
      AND pg_catalog.clock_timestamp() - v_table_started_at >= v_table_budget;

    WITH batch AS (
      SELECT runs.ctid AS row_ctid
      FROM cron.job_run_details AS runs
      WHERE COALESCE(runs.end_time, runs.start_time) < v_cron_cutoff
      LIMIT v_batch_size
    )
    DELETE FROM cron.job_run_details AS target
    USING batch
    WHERE target.ctid = batch.row_ctid;

    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    cron_job_run_details_deleted := cron_job_run_details_deleted + v_batch_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_batch_deleted < v_batch_size;
  END LOOP;

  v_table_started_at := pg_catalog.clock_timestamp();
  v_batches := 0;
  LOOP
    EXIT WHEN v_batches >= v_max_batches_per_table;
    EXIT WHEN v_batches > 0
      AND pg_catalog.clock_timestamp() - v_table_started_at >= v_table_budget;

    WITH batch AS (
      SELECT responses.ctid AS row_ctid
      FROM net._http_response AS responses
      WHERE responses.created < v_pg_net_cutoff
      LIMIT v_batch_size
    )
    DELETE FROM net._http_response AS target
    USING batch
    WHERE target.ctid = batch.row_ctid;

    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    pg_net_responses_deleted := pg_net_responses_deleted + v_batch_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_batch_deleted < v_batch_size;
  END LOOP;

  -- Audit finding R1 follow-up: rows written before the visitor user agent was
  -- dropped at ingest still carry event_data.user_agent. Once a row is older
  -- than v_personal_data_retention (OWNER DECISION: 90 days, the single place
  -- the period is set; age is the analytics row's own created_at, the column
  -- the partial index is keyed on), remove ONLY that key (object payloads only, so a
  -- non-object row is never changed). Other event_data
  -- keys stay and no row is deleted. Batches of 10,000 with SKIP LOCKED and
  -- its own 4 second budget; leftovers carry to the next run.
  v_scrub_cutoff := v_now - v_personal_data_retention;
  v_scrub_deadline := pg_catalog.clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_events AS (
      SELECT events.id
      FROM public.analytics_events AS events
      WHERE events.created_at < v_scrub_cutoff
        AND pg_catalog.jsonb_typeof(events.event_data) = 'object'
        AND events.event_data ? 'user_agent'
      ORDER BY events.created_at
      LIMIT v_scrub_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.analytics_events AS target
    SET event_data = target.event_data - 'user_agent'
    FROM expired_events AS expired
    WHERE target.id = expired.id
      AND pg_catalog.jsonb_typeof(target.event_data) = 'object'
      AND target.event_data ? 'user_agent';

    GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
    EXIT WHEN v_scrubbed < v_scrub_batch_size
      OR pg_catalog.clock_timestamp() > v_scrub_deadline;
  END LOOP;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.cleanup_database_retention(interval, interval, interval)
  IS 'Service-role maintenance cleanup for low-value analytics events, the 90 day removal of event_data.user_agent from old analytics events, pg_cron job history, and pg_net response history in bounded batches.';

REVOKE ALL ON FUNCTION public.cleanup_database_retention(interval, interval, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_database_retention(interval, interval, interval)
  TO service_role;
