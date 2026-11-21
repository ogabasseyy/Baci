-- Stage 3 operational hardening: automatic edge quiz reconciliation inside the
-- database deadline clock (`private.process_due_quiz_deadline_stages_v2`).
--
-- Finds due `edge_rooms` events whose room manifests are fully reconciled and
-- invokes `private.score_and_materialize_edge_quiz_event_v2(event_id, NULL)`
-- with per-event exception isolation so a single failing event never blocks
-- sibling events or downstream test/live deadline stages.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_due_edge_quiz_events_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_failed integer := 0;
  v_pending integer := 0;
  v_reconcile jsonb;
  v_reconciled integer := 0;
BEGIN
  FOR v_event_id IN
    SELECT event.id
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.backend_mode = 'edge_rooms'
      AND event.edge_completed_scoring_run_id IS NULL
      AND event.results_published_at IS NULL
      AND event.status IN ('active', 'completed', 'cancelled')
      AND (
        event.ends_at <= pg_catalog.clock_timestamp()
        OR event.status = 'cancelled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM private.quiz_edge_scoring_runs AS active_run
        WHERE active_run.event_id = event.id
          AND active_run.status = 'running'
      )
    ORDER BY event.ends_at ASC, event.id ASC
  LOOP
    BEGIN
      v_reconcile := private.quiz_edge_reconciliation_snapshot_v2(v_event_id);
      IF COALESCE((v_reconcile ->> 'manifestReconciled')::boolean, false) IS NOT TRUE THEN
        v_pending := v_pending + 1;
        CONTINUE;
      END IF;

      PERFORM private.score_and_materialize_edge_quiz_event_v2(v_event_id, NULL);
      v_reconciled := v_reconciled + 1;
      EXIT WHEN v_reconciled >= 10;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'edgeReconciled', v_reconciled,
    'edgeReconcilePending', v_pending,
    'edgeReconcileFailed', v_failed
  );
END;
$$;

ALTER FUNCTION public.reconcile_due_edge_quiz_events_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_due_edge_quiz_events_v2()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_due_edge_quiz_events_v2()
  TO service_role;

CREATE OR REPLACE FUNCTION private.process_due_quiz_deadline_stages_v2(
  p_production_phase boolean,
  p_production_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_awards jsonb := '{}'::jsonb;
  v_edge jsonb := '{}'::jsonb;
  v_edge_stage_failed integer := 0;
  v_live jsonb := '{}'::jsonb;
  v_live_failed integer := 0;
  v_live_finalize_failed integer := 0;
  v_promoted integer := 0;
  v_promotion_failed integer := 0;
  v_test jsonb := '{}'::jsonb;
  v_test_failed integer := 0;
BEGIN
  BEGIN
    v_promoted := private.promote_due_scheduled_quiz_events_clock_v2();
  EXCEPTION WHEN OTHERS THEN
    v_promotion_failed := 1;
  END;

  BEGIN
    v_edge := COALESCE(
      public.reconcile_due_edge_quiz_events_v2(), '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_edge_stage_failed := 1;
  END;

  BEGIN
    v_test := COALESCE(
      private.finalize_due_test_quiz_events_clock_v2(), '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_test_failed := 1;
  END;

  BEGIN
    v_live := COALESCE(
      private.terminalize_due_live_quiz_events_clock_v2(), '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_live_failed := 1;
  END;

  BEGIN
    v_awards := COALESCE(
      public.finalize_due_live_quiz_events_v2(
        p_production_phase, p_production_approved
      ),
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_live_finalize_failed := 1;
  END;

  RETURN pg_catalog.jsonb_build_object(
    'scheduledPromoted', v_promoted,
    'scheduledPromotionFailed', v_promotion_failed,
    'edgeReconcileStageFailed', v_edge_stage_failed,
    'testDeadlineClockFailed', v_test_failed,
    'liveDeadlineClockFailed', v_live_failed,
    'deadlineClockFailed', v_test_failed + v_live_failed,
    'liveFinalizationFailed', v_live_finalize_failed
  ) || v_edge || v_test || v_live || v_awards;
END;
$$;

ALTER FUNCTION private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
