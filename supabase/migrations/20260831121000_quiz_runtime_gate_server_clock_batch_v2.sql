-- Bind live publication approval to server-controlled transaction time.
-- Custom GUCs are caller-settable and therefore cannot authorize publication.

BEGIN;

CREATE OR REPLACE FUNCTION private.guard_live_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate_open boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'live'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    control.production_phase IS TRUE
      AND control.production_approved IS TRUE
      AND control.updated_at >=
        pg_catalog.transaction_timestamp() - interval '30 seconds'
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

ALTER FUNCTION private.guard_live_quiz_result_publication_v2()
  OWNER TO postgres;
ALTER FUNCTION private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_live_quiz_result_publication_v2(),
  private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
