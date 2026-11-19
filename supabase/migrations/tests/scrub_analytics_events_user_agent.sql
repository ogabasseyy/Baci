-- Regression proof for audit finding R1 follow-up: cleanup_database_retention
-- removes ONLY event_data.user_agent from analytics_events rows older than 90
-- days. Other keys, recent rows and the row count stay as they were.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '00000000-0000-4000-8000-00000000a501';
  v_old uuid := '00000000-0000-4000-8000-00000000a511';
  v_old_no_ua uuid := '00000000-0000-4000-8000-00000000a512';
  v_recent uuid := '00000000-0000-4000-8000-00000000a513';
  v_old_null_ua uuid := '00000000-0000-4000-8000-00000000a514';
  v_data jsonb;
  v_count bigint;
BEGIN
  -- event_type 'purchase' so the unrelated low-value delete never touches them.
  INSERT INTO public.analytics_events (id, merchant_id, event_type, event_data, created_at, event_timestamp)
  VALUES
    (v_old, v_merchant, 'purchase', '{"user_agent":"Agent/1.0","session_id":"s1","value":10}', now() - interval '100 days', now() - interval '100 days'),
    (v_old_no_ua, v_merchant, 'purchase', '{"session_id":"s2"}', now() - interval '100 days', now() - interval '100 days'),
    (v_recent, v_merchant, 'purchase', '{"user_agent":"Agent/2.0","session_id":"s3"}', now() - interval '10 days', now() - interval '10 days'),
    (v_old_null_ua, v_merchant, 'purchase', '{"user_agent":null,"session_id":"s4"}', now() - interval '100 days', now() - interval '100 days');

  PERFORM public.cleanup_database_retention();

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

  SELECT count(*) INTO v_count FROM public.analytics_events WHERE merchant_id = v_merchant;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'rows were deleted: %', v_count;
  END IF;

  -- Callable only by service_role, as before.
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
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND indexname = 'analytics_events_user_agent_scrub_idx'
      AND indexdef LIKE '%WHERE%user_agent%'
  ) THEN
    RAISE EXCEPTION 'partial user_agent scrub index missing';
  END IF;
END;
$$;

ROLLBACK;
