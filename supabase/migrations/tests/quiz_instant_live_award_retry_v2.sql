BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified,
  mode, contract_version, rules_version, attempts_terminalized_at,
  finalization_state, claim_window_seconds, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref
) VALUES (
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  'instant-award-retry-proof', 'Instant award retry proof', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute', 60, true,
  'live', 2, 'instant-v2', pg_catalog.clock_timestamp(),
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence'
), (
  '74000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000002',
  'instant-gate-backlog-proof', 'Instant gate backlog proof', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute', 60, true,
  'live', 2, 'instant-v2', pg_catalog.clock_timestamp(),
  'blocked', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence'
);
UPDATE public.quiz_events
SET finalization_error_code = 'live_award_gate_unavailable'
WHERE id = '74000000-0000-4000-8000-000000000005';
INSERT INTO public.quiz_prize_reservations(
  id, event_id, merchant_id, product_id, inventory_kind, state
) VALUES (
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000004',
  'unlimited', 'reserved'
);
CREATE OR REPLACE FUNCTION private.materialize_quiz_event_results_v2(
  p_event_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'forced_live_award_transfer_failure';
END;
$$;

DO $$
DECLARE
  v_failure_logs integer;
  v_gate_rows integer;
  v_summary jsonb;
BEGIN
  v_summary := public.finalize_due_live_quiz_events_v2(false, false);
  IF COALESCE((v_summary ->> 'liveAwaitingGate')::integer, 0) <> 2 THEN
    RAISE EXCEPTION 'gate summary omitted an already-blocked live event';
  END IF;
  v_summary := public.finalize_due_live_quiz_events_v2(false, false);
  IF COALESCE((v_summary ->> 'liveAwaitingGate')::integer, 0) <> 2 THEN
    RAISE EXCEPTION 'repeated gate summary lost the blocked backlog';
  END IF;

  UPDATE public.quiz_events
  SET starts_at = pg_catalog.clock_timestamp() + interval '1 minute',
      ends_at = pg_catalog.clock_timestamp() + interval '2 minutes'
  WHERE id = '74000000-0000-4000-8000-000000000005';
  UPDATE public.quiz_runtime_control_v2
  SET production_phase = true,
      production_approved = true,
      updated_at = pg_catalog.clock_timestamp()
  WHERE singleton;
  GET DIAGNOSTICS v_gate_rows = ROW_COUNT;
  IF v_gate_rows <> 1 THEN
    RAISE EXCEPTION 'quiz_runtime_control_v2 singleton row is missing';
  END IF;

  v_summary := public.finalize_due_live_quiz_events_v2(true, true);
  IF COALESCE((v_summary ->> 'failed')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'initial live award failure was not recorded';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_failure_logs
  FROM public.leaderboard_refresh_log AS log
  WHERE log.event_id = '74000000-0000-4000-8000-000000000001'
    AND log.refresh_reason = 'quiz_v2_live_finalized'
    AND log.status = 'failed';
  IF v_failure_logs <> 1 THEN
    RAISE EXCEPTION 'initial live award failure log was not inserted once';
  END IF;

  v_summary := public.finalize_due_live_quiz_events_v2(true, true);
  IF COALESCE(
    (v_summary ->> 'liveAwardRetryPending')::integer, 0
  ) <> 1 OR COALESCE((v_summary ->> 'failed')::integer, 0) <> 0
    OR COALESCE((v_summary ->> 'liveAwaitingGate')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'live award retried inside its 30-second backoff';
  END IF;

  UPDATE public.quiz_events
  SET updated_at = pg_catalog.clock_timestamp() - interval '31 seconds'
  WHERE id = '74000000-0000-4000-8000-000000000001';
  v_summary := public.finalize_due_live_quiz_events_v2(true, true);
  IF COALESCE((v_summary ->> 'failed')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'live award did not retry after its backoff';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_failure_logs
  FROM public.leaderboard_refresh_log AS log
  WHERE log.event_id = '74000000-0000-4000-8000-000000000001'
    AND log.refresh_reason = 'quiz_v2_live_finalized'
    AND log.status = 'failed';
  IF v_failure_logs <> 1 THEN
    RAISE EXCEPTION 'persistent live award failure emitted duplicate logs';
  END IF;
END;
$$;

SET LOCAL session_replication_role = origin;

ROLLBACK;
