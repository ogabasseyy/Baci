-- Regression proof for audit finding R1 follow-up: cleanup_database_retention
-- removes ONLY event_data.user_agent from analytics_events rows older than 90
-- days. Other keys, recent rows and the row count stay as they were. The age is
-- the row's own created_at, not event_timestamp (two rows with divergent
-- timestamps pin that). The existing low-value delete (page_view / search older
-- than 30 days) is exercised too, so its rewritten loop is pinned.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '00000000-0000-4000-8000-00000000a501';
  v_old uuid := '00000000-0000-4000-8000-00000000a511';
  v_old_no_ua uuid := '00000000-0000-4000-8000-00000000a512';
  v_recent uuid := '00000000-0000-4000-8000-00000000a513';
  v_old_null_ua uuid := '00000000-0000-4000-8000-00000000a514';
  v_user uuid := '00000000-0000-4000-8000-00000000a500';
  v_arr uuid := '00000000-0000-4000-8000-00000000a515';
  v_old_created_recent_ts uuid := '00000000-0000-4000-8000-00000000a516';
  v_recent_created_old_ts uuid := '00000000-0000-4000-8000-00000000a517';
  v_old_page_view uuid := '00000000-0000-4000-8000-00000000a518';
  v_old_search uuid := '00000000-0000-4000-8000-00000000a519';
  v_recent_page_view uuid := '00000000-0000-4000-8000-00000000a51a';
  v_data jsonb;
  v_count bigint;
  v_low_value_deleted bigint;
BEGIN
  ALTER TABLE public.merchants DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'scrub-ua@example.com', 'test', now(), now(), now(), '{}', '{}');
  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (v_merchant, v_user, 'scrub-ua@example.com', 'Scrub UA', 'scrub-ua');
  ALTER TABLE public.merchants ENABLE TRIGGER USER;

  -- The scrub rows use event_type 'purchase' so the unrelated low-value delete
  -- never touches them; the three page_view/search rows at the end are the
  -- low-value delete's own pins.
  INSERT INTO public.analytics_events (id, merchant_id, event_type, event_data, created_at, event_timestamp)
  VALUES
    (v_old, v_merchant, 'purchase', '{"user_agent":"Agent/1.0","session_id":"s1","value":10}', now() - interval '100 days', now() - interval '100 days'),
    (v_old_no_ua, v_merchant, 'purchase', '{"session_id":"s2"}', now() - interval '100 days', now() - interval '100 days'),
    (v_recent, v_merchant, 'purchase', '{"user_agent":"Agent/2.0","session_id":"s3"}', now() - interval '10 days', now() - interval '10 days'),
    (v_arr, v_merchant, 'purchase', '["user_agent","x"]', now() - interval '100 days', now() - interval '100 days'),
    (v_old_null_ua, v_merchant, 'purchase', '{"user_agent":null,"session_id":"s4"}', now() - interval '100 days', now() - interval '100 days'),
    -- Divergent timestamps pin that the scrub age is created_at, not event_timestamp.
    (v_old_created_recent_ts, v_merchant, 'purchase', '{"user_agent":"Agent/3.0","session_id":"s5"}', now() - interval '100 days', now() - interval '10 days'),
    (v_recent_created_old_ts, v_merchant, 'purchase', '{"user_agent":"Agent/4.0","session_id":"s6"}', now() - interval '10 days', now() - interval '100 days'),
    -- Low-value rows: older than the 30 day low-value cutoff are deleted, newer stay.
    (v_old_page_view, v_merchant, 'page_view', '{"session_id":"s7"}', now() - interval '40 days', now() - interval '40 days'),
    (v_old_search, v_merchant, 'search', '{"session_id":"s8"}', now() - interval '40 days', now() - interval '40 days'),
    (v_recent_page_view, v_merchant, 'page_view', '{"session_id":"s9"}', now() - interval '5 days', now() - interval '5 days');

  SELECT analytics_events_deleted INTO v_low_value_deleted FROM public.cleanup_database_retention();

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_old;
  IF v_data ? 'user_agent' THEN
    RAISE EXCEPTION 'old row kept user_agent: %', v_data;
  END IF;
  IF v_data <> '{"session_id":"s1","value":10}'::jsonb THEN
    RAISE EXCEPTION 'old row lost other keys: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_old_no_ua;
  IF v_data <> '{"session_id":"s2"}'::jsonb THEN
    RAISE EXCEPTION 'row without user_agent changed: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_recent;
  IF v_data->>'user_agent' IS DISTINCT FROM 'Agent/2.0' THEN
    RAISE EXCEPTION 'recent row was scrubbed: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_old_null_ua;
  IF v_data ? 'user_agent' THEN
    RAISE EXCEPTION 'old row with null user_agent key kept the key: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_arr;
  IF v_data <> '["user_agent","x"]'::jsonb THEN
    RAISE EXCEPTION 'non-object payload was modified: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_old_created_recent_ts;
  IF v_data IS NULL OR v_data ? 'user_agent' OR v_data <> '{"session_id":"s5"}'::jsonb THEN
    RAISE EXCEPTION 'row with old created_at but recent event_timestamp was not scrubbed: %', v_data;
  END IF;

  SELECT event_data INTO v_data FROM public.analytics_events WHERE id = v_recent_created_old_ts;
  IF v_data->>'user_agent' IS DISTINCT FROM 'Agent/4.0' THEN
    RAISE EXCEPTION 'row with recent created_at but old event_timestamp was scrubbed: %', v_data;
  END IF;

  -- Low-value delete: the old page_view and search rows are gone, the recent one stays.
  IF EXISTS (SELECT 1 FROM public.analytics_events WHERE id IN (v_old_page_view, v_old_search)) THEN
    RAISE EXCEPTION 'old low-value page_view/search rows were not deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.analytics_events WHERE id = v_recent_page_view) THEN
    RAISE EXCEPTION 'recent page_view row was deleted';
  END IF;
  IF v_low_value_deleted < 2 THEN
    RAISE EXCEPTION 'analytics_events_deleted did not count the old low-value rows: %', v_low_value_deleted;
  END IF;

  -- Ten rows went in and only the two old low-value rows may be gone, so the
  -- scrub itself deleted nothing.
  SELECT count(*) INTO v_count FROM public.analytics_events WHERE merchant_id = v_merchant;
  IF v_count <> 8 THEN
    RAISE EXCEPTION 'unexpected analytics_events row count after cleanup (expected 8): %', v_count;
  END IF;

  -- Callable only by service_role, as before (the VPS retention worker calls it).
  IF NOT has_function_privilege('service_role', 'public.cleanup_database_retention(interval, interval, interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on cleanup_database_retention';
  END IF;
  IF has_function_privilege('authenticated', 'public.cleanup_database_retention(interval, interval, interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cleanup_database_retention(interval, interval, interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cleanup_database_retention is executable by a non service_role';
  END IF;
END;
$$;

-- The partial index exists, is valid and is partial.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_index AS index_state ON index_state.indexrelid = index_class.oid
    WHERE index_class.oid = 'public.analytics_events_user_agent_scrub_idx'::regclass
      AND index_state.indisvalid AND index_state.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'partial user_agent scrub index missing';
  END IF;
END;
$$;

ROLLBACK;
