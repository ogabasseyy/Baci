-- Stage 3 operational hardening SQL verification:
-- Verifies `public.reconcile_due_edge_quiz_events_v2()` privileges, signature,
-- return shape, and isolated wiring inside `private.process_due_quiz_deadline_stages_v2`.

DO $$
DECLARE
  v_reconcile_def text;
  v_stage_def text;
  v_result jsonb;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.reconcile_due_edge_quiz_events_v2()'::regprocedure
  ) INTO v_reconcile_def;

  IF pg_catalog.strpos(v_reconcile_def, 'SECURITY DEFINER') = 0
    OR pg_catalog.strpos(v_reconcile_def, 'score_and_materialize_edge_quiz_event_v2') = 0
    OR pg_catalog.strpos(v_reconcile_def, 'quiz_edge_reconciliation_snapshot_v2') = 0
    OR pg_catalog.strpos(v_reconcile_def, '''active''') = 0
    OR pg_catalog.strpos(v_reconcile_def, '''completed''') = 0
    OR pg_catalog.strpos(v_reconcile_def, '''cancelled''') = 0
    OR pg_catalog.strpos(v_reconcile_def, 'v_reconciled >= 10') = 0
  THEN
    RAISE EXCEPTION 'reconcile_due_edge_quiz_events_v2 missing expected security/reconciliation wiring';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.reconcile_due_edge_quiz_events_v2()', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'public.reconcile_due_edge_quiz_events_v2()', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', 'public.reconcile_due_edge_quiz_events_v2()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'reconcile_due_edge_quiz_events_v2 EXECUTE privileges are misconfigured';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'private.process_due_quiz_deadline_stages_v2(boolean,boolean)'::regprocedure
  ) INTO v_stage_def;

  IF pg_catalog.strpos(v_stage_def, 'public.reconcile_due_edge_quiz_events_v2()') = 0
    OR pg_catalog.strpos(v_stage_def, 'edgeReconcileStageFailed') = 0
  THEN
    RAISE EXCEPTION 'process_due_quiz_deadline_stages_v2 does not invoke reconcile_due_edge_quiz_events_v2';
  END IF;

  v_result := public.reconcile_due_edge_quiz_events_v2();
  IF NOT (v_result ? 'edgeReconciled')
    OR NOT (v_result ? 'edgeReconcilePending')
    OR NOT (v_result ? 'edgeReconcileFailed')
  THEN
    RAISE EXCEPTION 'reconcile_due_edge_quiz_events_v2 returned unexpected payload: %', v_result;
  END IF;
END;
$$;
