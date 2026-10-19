-- A stale runtime gate is fail-closed for live awards and must also remain
-- visible as degraded deadline-clock health.

BEGIN;

CREATE OR REPLACE FUNCTION private.run_quiz_deadline_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approved boolean := false;
  v_failed integer;
  v_gate_fresh boolean := false;
  v_gate_updated_at timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_phase boolean := false;
  v_summary jsonb;
BEGIN
  SELECT
    control.production_phase,
    control.production_approved,
    control.updated_at
  INTO v_phase, v_approved, v_gate_updated_at
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

  v_gate_fresh := v_gate_updated_at IS NOT NULL
    AND v_gate_updated_at > v_now - interval '30 seconds';
  IF NOT v_gate_fresh THEN
    v_phase := false;
    v_approved := false;
  END IF;

  BEGIN
    v_summary := COALESCE(
      private.process_due_quiz_deadline_stages_v2(
        COALESCE(v_phase, false), COALESCE(v_approved, false)
      ),
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_summary := pg_catalog.jsonb_build_object('deadlineClockFailed', 1);
  END;
  v_summary := v_summary || pg_catalog.jsonb_build_object(
    'runtimeGateFresh', v_gate_fresh
  );

  v_failed :=
    CASE WHEN v_gate_fresh THEN 0 ELSE 1 END
    + COALESCE((v_summary ->> 'failed')::integer, 0)
    + COALESCE((v_summary ->> 'liveAwardRetryPending')::integer, 0)
    + COALESCE((v_summary ->> 'testPublicationFailed')::integer, 0)
    + COALESCE((v_summary ->> 'testPublicationRetryPending')::integer, 0)
    + COALESCE((v_summary ->> 'liveTerminalizationFailed')::integer, 0)
    + COALESCE(
        (v_summary ->> 'liveTerminalizationRetryPending')::integer, 0
      )
    + COALESCE((v_summary ->> 'scheduledPromotionFailed')::integer, 0)
    + COALESCE((v_summary ->> 'deadlineClockFailed')::integer, 0)
    + COALESCE((v_summary ->> 'liveFinalizationFailed')::integer, 0);

  IF v_failed > 0 THEN
    INSERT INTO public.quiz_deadline_clock_health_v2(
      singleton, last_run_at, last_failure_at, consecutive_failures,
      last_failure_count, last_summary, updated_at
    ) VALUES (
      true, v_now, v_now, 1, v_failed, v_summary, v_now
    )
    ON CONFLICT (singleton) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_failure_at = EXCLUDED.last_failure_at,
        consecutive_failures =
          public.quiz_deadline_clock_health_v2.consecutive_failures + 1,
        last_failure_count = EXCLUDED.last_failure_count,
        last_summary = EXCLUDED.last_summary,
        updated_at = EXCLUDED.updated_at;
    RAISE WARNING 'QUIZ_DEADLINE_CLOCK_DEGRADED failures=%', v_failed;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.quiz_deadline_clock_health_v2 AS health
    WHERE health.singleton
      AND health.consecutive_failures = 0
      AND health.last_run_at > v_now - interval '30 seconds'
  ) THEN
    INSERT INTO public.quiz_deadline_clock_health_v2(
      singleton, last_run_at, last_success_at, consecutive_failures,
      last_failure_count, last_summary, updated_at
    ) VALUES (
      true, v_now, v_now, 0, 0, v_summary, v_now
    )
    ON CONFLICT (singleton) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_success_at = EXCLUDED.last_success_at,
        consecutive_failures = 0,
        last_failure_count = 0,
        last_summary = EXCLUDED.last_summary,
        updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN v_summary;
END;
$$;

ALTER FUNCTION private.run_quiz_deadline_clock_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.run_quiz_deadline_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
