BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.merchants(
  id, user_id, email, business_name, slug
) VALUES (
  '76000000-0000-4000-8000-000000000002',
  '76000000-0000-4000-8000-000000000004',
  'retry-pending-proof@example.com',
  'Retry pending proof', 'retry-pending-proof'
);
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified, mode, contract_version,
  rules_version, regulatory_basis, regulatory_jurisdiction,
  regulatory_evidence_ref, finalization_state, finalization_error_code,
  updated_at
) VALUES (
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000002',
  'test-retry-pending-proof', 'Test retry pending proof', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute', 60, true,
  'test', 2, 'instant-v2', 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence', 'blocked',
  'test_result_publication_failed', pg_catalog.clock_timestamp()
), (
  '76000000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000002',
  'live-terminal-retry-pending-proof',
  'Live terminal retry pending proof', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute', 60, true,
  'live', 2, 'instant-v2', 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence', 'blocked',
  'live_attempt_terminalization_failed', pg_catalog.clock_timestamp()
);
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
  v_consecutive_failures integer;
  v_failure_count integer;
  v_summary jsonb;
BEGIN
  v_summary := private.finalize_due_test_quiz_events_clock_v2();
  IF COALESCE(
    (v_summary ->> 'testPublicationRetryPending')::integer, 0
  ) <> 1 OR COALESCE((v_summary ->> 'testClosed')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'test publication retried inside its backoff: %', v_summary;
  END IF;

  v_summary := private.terminalize_due_live_quiz_events_clock_v2();
  IF COALESCE(
    (v_summary ->> 'liveTerminalizationRetryPending')::integer, 0
  ) <> 1 OR COALESCE((v_summary ->> 'liveTerminalized')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'live terminalization retried inside its backoff: %',
      v_summary;
  END IF;

  PERFORM private.run_quiz_deadline_clock_v2();
  SELECT health.consecutive_failures, health.last_failure_count
  INTO v_consecutive_failures, v_failure_count
  FROM public.quiz_deadline_clock_health_v2 AS health
  WHERE health.singleton;
  IF COALESCE(v_consecutive_failures, 0) < 1
    OR COALESCE(v_failure_count, 0) < 2 THEN
    RAISE EXCEPTION 'retry-pending backlog is absent from clock health';
  END IF;

  UPDATE public.quiz_events
  SET updated_at = pg_catalog.clock_timestamp() - interval '31 seconds'
  WHERE id IN (
    '76000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000003'
  );

  v_summary := private.finalize_due_test_quiz_events_clock_v2();
  IF COALESCE((v_summary ->> 'testClosed')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'test publication did not resume after backoff: %',
      v_summary;
  END IF;

  v_summary := private.terminalize_due_live_quiz_events_clock_v2();
  IF COALESCE((v_summary ->> 'liveTerminalized')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'live terminalization did not resume after backoff: %',
      v_summary;
  END IF;
END;
$$;

ROLLBACK;
