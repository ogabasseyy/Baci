-- Separate the runtime gate write from deadline processing so a disabled gate
-- commits before concurrent cron work can observe it. A transaction-local,
-- bounded batch marker keeps an already-approved long batch valid without
-- extending the persisted heartbeat.

BEGIN;

UPDATE public.quiz_runtime_control_v2
SET production_phase = false,
    production_approved = false,
    updated_at = pg_catalog.clock_timestamp()
WHERE singleton;

CREATE OR REPLACE FUNCTION public.set_quiz_runtime_control_v2(
  p_production_phase boolean,
  p_production_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.quiz_runtime_control_v2(
    singleton, production_phase, production_approved, updated_at
  ) VALUES (
    true,
    COALESCE(p_production_phase, false),
    COALESCE(p_production_approved, false),
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (singleton) DO UPDATE
  SET production_phase = EXCLUDED.production_phase,
      production_approved = EXCLUDED.production_approved,
      updated_at = EXCLUDED.updated_at;

  RETURN pg_catalog.jsonb_build_object('updated', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_live_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_active boolean := false;
  v_batch_value text;
  v_gate_open boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'live'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_batch_value := pg_catalog.current_setting(
    'baci.quiz_live_publication_batch_xid', true
  );
  v_batch_active := v_batch_value IS NOT NULL
    AND v_batch_value = pg_catalog.pg_current_xact_id()::text;

  SELECT
    control.production_phase IS TRUE
      AND control.production_approved IS TRUE
      AND (
        control.updated_at >=
          pg_catalog.clock_timestamp() - interval '30 seconds'
        OR v_batch_active
      )
  INTO v_gate_open
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_gate_open, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_live_publication_runtime_gate_closed';
  END IF;

  RETURN NEW;
END;
$$;

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

  IF p_production_phase IS TRUE
    AND p_production_approved IS TRUE THEN
    PERFORM pg_catalog.set_config(
      'baci.quiz_live_publication_batch_xid',
      pg_catalog.pg_current_xact_id()::text,
      true
    );
  ELSE
    PERFORM pg_catalog.set_config(
      'baci.quiz_live_publication_batch_xid', '', true
    );
  END IF;

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
    'testDeadlineClockFailed', v_test_failed,
    'liveDeadlineClockFailed', v_live_failed,
    'deadlineClockFailed', v_test_failed + v_live_failed,
    'liveFinalizationFailed', v_live_finalize_failed
  ) || v_test || v_live || v_awards;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_quiz_deadlines_v2(
  p_production_phase boolean,
  p_production_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approved boolean := false;
  v_fresh boolean := false;
  v_matches boolean := false;
  v_phase boolean := false;
  v_summary jsonb;
  v_updated_at timestamptz;
BEGIN
  SELECT
    control.production_phase,
    control.production_approved,
    control.updated_at
  INTO v_phase, v_approved, v_updated_at
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

  v_fresh := v_updated_at IS NOT NULL
    AND v_updated_at > pg_catalog.clock_timestamp() - interval '30 seconds';
  v_matches := COALESCE(v_phase, false) =
      COALESCE(p_production_phase, false)
    AND COALESCE(v_approved, false) =
      COALESCE(p_production_approved, false);

  v_summary := private.process_due_quiz_deadline_stages_v2(
    COALESCE(v_phase, false) AND v_fresh AND v_matches,
    COALESCE(v_approved, false) AND v_fresh AND v_matches
  );

  RETURN v_summary || pg_catalog.jsonb_build_object(
    'runtimeGateFresh', v_fresh,
    'runtimeGateMatches', v_matches
  );
END;
$$;

ALTER FUNCTION public.set_quiz_runtime_control_v2(boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION private.guard_live_quiz_result_publication_v2()
  OWNER TO postgres;
ALTER FUNCTION private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_quiz_runtime_control_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_quiz_runtime_control_v2(boolean, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION private.guard_live_quiz_result_publication_v2(),
  private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_quiz_deadlines_v2(
  boolean, boolean
) TO service_role;

COMMIT;
