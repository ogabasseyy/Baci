BEGIN;

DO $$
DECLARE
  v_control_rls boolean;
  v_finalizer_definition text;
  v_guard_definition text;
  v_health_rls boolean;
  v_index_definition text;
  v_index_valid boolean;
  v_processor_definition text;
  v_runner_definition text;
  v_setter_definition text;
  v_stage_definition text;
  v_test_clock_definition text;
  v_terminalizer_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.terminalize_due_live_quiz_events_clock_v2()'::regprocedure
  ) INTO v_terminalizer_definition;
  IF pg_catalog.strpos(
    v_terminalizer_definition, 'attempts_terminalized_at IS NULL'
  ) = 0 OR pg_catalog.strpos(
    v_terminalizer_definition,
    'live_attempt_terminalization_failed'') NULLS FIRST'
  ) = 0 THEN
    RAISE EXCEPTION 'terminalized live events remain in the clock queue';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'private.finalize_due_test_quiz_events_clock_v2()'::regprocedure
  ) INTO v_test_clock_definition;
  IF v_test_clock_definition !~
      'finalization_error_code IS DISTINCT FROM(.|\n)*test_result_publication_failed(.|\n)*updated_at <=(.|\n)*interval ''30 seconds'''
    OR pg_catalog.strpos(
      v_test_clock_definition,
      'test_result_publication_failed'') NULLS FIRST'
    ) = 0 THEN
    RAISE EXCEPTION 'failed test events do not have a bounded retry interval';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.set_quiz_runtime_control_v2(boolean,boolean)'::regprocedure
  ) INTO v_setter_definition;
  SELECT pg_catalog.pg_get_functiondef(
    'public.process_due_quiz_deadlines_v2(boolean,boolean)'::regprocedure
  ) INTO v_processor_definition;
  IF pg_catalog.strpos(
    v_setter_definition, 'INSERT INTO public.quiz_runtime_control_v2'
  ) = 0 OR pg_catalog.strpos(
    v_processor_definition, 'INSERT INTO public.quiz_runtime_control_v2'
  ) <> 0 OR pg_catalog.strpos(
    v_processor_definition, 'FROM public.quiz_runtime_control_v2 AS control'
  ) = 0 THEN
    RAISE EXCEPTION 'runtime gate is not committed before deadline processing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.finalize_due_live_quiz_events_v2(boolean,boolean)'::regprocedure
  ) INTO v_finalizer_definition;
  IF pg_catalog.strpos(v_finalizer_definition, 'auth.role()') <> 0
    OR pg_catalog.strpos(
      v_finalizer_definition, 'quiz_live_prize_regulatory_ready_v2'
    ) = 0
    OR pg_catalog.strpos(
      v_finalizer_definition, 'materialize_quiz_event_results_v2'
    ) = 0
  THEN
    RAISE EXCEPTION 'database-clock live publication is not safely gated';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'private.process_due_quiz_deadline_stages_v2(boolean,boolean)'::regprocedure
  ) INTO v_stage_definition;
  IF v_stage_definition !~
      'v_promoted := private\.promote_due_scheduled_quiz_events_clock_v2\(\)(.|\n)*v_promotion_failed := 1'
    OR v_stage_definition !~
      'v_test := COALESCE\((.|\n)*finalize_due_test_quiz_events_clock_v2\(\)(.|\n)*v_test_failed := 1'
    OR v_stage_definition !~
      'v_live := COALESCE\((.|\n)*terminalize_due_live_quiz_events_clock_v2\(\)(.|\n)*v_live_failed := 1'
    OR v_stage_definition !~
      'v_awards := COALESCE\((.|\n)*finalize_due_live_quiz_events_v2\((.|\n)*v_live_finalize_failed := 1'
    OR v_stage_definition !~
      '''scheduledPromotionFailed''[[:space:]]*,[[:space:]]*v_promotion_failed'
    OR v_stage_definition !~
      '''testDeadlineClockFailed''[[:space:]]*,[[:space:]]*v_test_failed'
    OR v_stage_definition !~
      '''liveDeadlineClockFailed''[[:space:]]*,[[:space:]]*v_live_failed'
    OR v_stage_definition !~
      '''deadlineClockFailed''[[:space:]]*,[[:space:]]*v_test_failed[[:space:]]*\+[[:space:]]*v_live_failed'
    OR v_stage_definition !~
      '''liveFinalizationFailed''[[:space:]]*,[[:space:]]*v_live_finalize_failed'
  THEN
    RAISE EXCEPTION 'deadline stages are not isolated and observable';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'private.run_quiz_deadline_clock_v2()'::regprocedure
  ) INTO v_runner_definition;
  IF pg_catalog.strpos(v_runner_definition, 'quiz_runtime_control_v2') = 0
    OR pg_catalog.strpos(v_runner_definition, 'control.updated_at') = 0
    OR pg_catalog.strpos(
      v_runner_definition, 'interval ''30 seconds'''
    ) = 0
    OR pg_catalog.strpos(v_runner_definition, '''runtimeGateFresh''') = 0
    OR pg_catalog.strpos(
      v_runner_definition, '''liveAwardRetryPending'''
    ) = 0
    OR pg_catalog.strpos(
      v_runner_definition, 'process_due_quiz_deadlines_v2(true, true)'
    ) <> 0
  THEN
    RAISE EXCEPTION 'database clock bypasses the production approval gate';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'private.guard_live_quiz_result_publication_v2()'::regprocedure
  ) INTO v_guard_definition;
  IF pg_catalog.strpos(v_guard_definition, 'quiz_runtime_control_v2') = 0
    OR pg_catalog.strpos(v_guard_definition, 'interval ''30 seconds''') = 0
    OR pg_catalog.strpos(
      v_guard_definition, 'transaction_timestamp()'
    ) = 0
    OR pg_catalog.strpos(
      v_guard_definition, 'baci.quiz_live_publication_batch_xid'
    ) <> 0 OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger
      WHERE trigger.tgname = 'guard_live_quiz_result_publication_v2'
        AND trigger.tgrelid = 'public.quiz_events'::regclass
        AND NOT trigger.tgisinternal
    )
  THEN
    RAISE EXCEPTION 'live publication replay interlock is missing';
  END IF;

  SELECT
    index_entry.indisvalid,
    pg_catalog.pg_get_indexdef(index_entry.indexrelid)
  INTO v_index_valid, v_index_definition
  FROM pg_catalog.pg_index AS index_entry
  JOIN pg_catalog.pg_class AS index_class
    ON index_class.oid = index_entry.indexrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = index_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND index_class.relname = 'quiz_events_v2_live_unpublished_due_idx';
  IF v_index_valid IS NOT TRUE
    OR pg_catalog.strpos(v_index_definition, '(ends_at, updated_at)') = 0
    OR pg_catalog.strpos(v_index_definition, 'contract_version = 2') = 0
    OR pg_catalog.strpos(v_index_definition, 'mode = ''live''') = 0
    OR pg_catalog.strpos(
      v_index_definition, 'attempts_terminalized_at IS NOT NULL'
    ) = 0
    OR pg_catalog.strpos(
      v_index_definition, 'results_published_at IS NULL'
    ) = 0
    OR pg_catalog.strpos(
      v_index_definition, 'finalization_state = ANY'
    ) = 0
    OR pg_catalog.strpos(v_index_definition, '''pending''::text') = 0
    OR pg_catalog.strpos(v_index_definition, '''blocked''::text') = 0 THEN
    RAISE EXCEPTION 'live deadline backlog lacks its partial index';
  END IF;

  IF pg_catalog.strpos(
    v_finalizer_definition, '''liveAwardRetryPending'''
  ) = 0 OR pg_catalog.strpos(
    v_finalizer_definition, 'interval ''30 seconds'''
  ) = 0 THEN
    RAISE EXCEPTION 'live award retry backoff is not reflected in health';
  END IF;

  SELECT class.relrowsecurity INTO v_health_rls
  FROM pg_catalog.pg_class AS class
  WHERE class.oid = 'public.quiz_deadline_clock_health_v2'::regclass;
  IF v_health_rls IS NOT TRUE OR pg_catalog.has_table_privilege(
    'authenticated', 'public.quiz_deadline_clock_health_v2', 'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'anon', 'public.quiz_deadline_clock_health_v2', 'SELECT'
  ) OR NOT pg_catalog.has_table_privilege(
    'service_role', 'public.quiz_deadline_clock_health_v2', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'deadline clock health signal has unsafe RLS or ACLs';
  END IF;

  SELECT class.relrowsecurity INTO v_control_rls
  FROM pg_catalog.pg_class AS class
  WHERE class.oid = 'public.quiz_runtime_control_v2'::regclass;
  IF v_control_rls IS NOT TRUE OR pg_catalog.has_table_privilege(
    'authenticated', 'public.quiz_runtime_control_v2', 'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'anon', 'public.quiz_runtime_control_v2', 'SELECT'
  ) OR NOT pg_catalog.has_table_privilege(
    'service_role', 'public.quiz_runtime_control_v2', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'quiz runtime control has unsafe RLS or ACLs';
  END IF;
END;
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified, mode, contract_version,
  rules_version, regulatory_basis, regulatory_jurisdiction,
  regulatory_evidence_ref
) VALUES (
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002',
  'runtime-publication-interlock-proof',
  'Runtime publication interlock proof', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute', 60, true,
  'live', 2, 'instant-v2', 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence'
);
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
  UPDATE public.quiz_runtime_control_v2
  SET production_phase = true,
      production_approved = true,
      updated_at = pg_catalog.clock_timestamp() - interval '31 seconds'
  WHERE singleton;

  BEGIN
    UPDATE public.quiz_events
    SET results_published_at = pg_catalog.clock_timestamp()
    WHERE id = '75000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'stale gate allowed live result publication';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'quiz_live_publication_runtime_gate_closed' THEN
      RAISE;
    END IF;
  END;

END;
$$;

DO $$
BEGIN
  UPDATE public.quiz_runtime_control_v2
  SET production_phase = false,
      production_approved = false,
      updated_at = pg_catalog.clock_timestamp()
  WHERE singleton;
  PERFORM pg_catalog.set_config(
    'baci.quiz_live_publication_batch_xid',
    pg_catalog.pg_current_xact_id()::text,
    true
  );

  BEGIN
    UPDATE public.quiz_events
    SET results_published_at = pg_catalog.clock_timestamp()
    WHERE id = '75000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'forged batch marker bypassed the closed runtime gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'quiz_live_publication_runtime_gate_closed' THEN
      RAISE;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_summary jsonb;
BEGIN
  UPDATE public.quiz_runtime_control_v2
  SET production_phase = true,
      production_approved = true,
      updated_at = pg_catalog.clock_timestamp() - interval '31 seconds'
  WHERE singleton;
  v_summary := private.run_quiz_deadline_clock_v2();
  IF COALESCE((v_summary ->> 'runtimeGateFresh')::boolean, true) THEN
    RAISE EXCEPTION 'stale runtime approval remained award-capable';
  END IF;

  UPDATE public.quiz_runtime_control_v2
  SET production_phase = true,
      production_approved = true,
      updated_at = pg_catalog.clock_timestamp()
  WHERE singleton;
  v_summary := private.run_quiz_deadline_clock_v2();
  IF COALESCE((v_summary ->> 'runtimeGateFresh')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'fresh runtime approval was not recognized';
  END IF;
END;
$$;

ROLLBACK;
