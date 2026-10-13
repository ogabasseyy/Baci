-- Persist the service-owned production gate for pg_cron and isolate every
-- deadline stage so one queue cannot block unrelated publication work.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quiz_runtime_control_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  production_phase boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

INSERT INTO public.quiz_runtime_control_v2(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.quiz_runtime_control_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role reads quiz runtime control v2"
  ON public.quiz_runtime_control_v2;
CREATE POLICY "service role reads quiz runtime control v2"
  ON public.quiz_runtime_control_v2
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.quiz_runtime_control_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quiz_runtime_control_v2 TO service_role;

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

CREATE OR REPLACE FUNCTION public.process_due_quiz_deadlines_v2(
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

  RETURN private.process_due_quiz_deadline_stages_v2(
    COALESCE(p_production_phase, false),
    COALESCE(p_production_approved, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.run_quiz_deadline_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approved boolean := false;
  v_failed integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_phase boolean := false;
  v_summary jsonb;
BEGIN
  SELECT control.production_phase, control.production_approved
  INTO v_phase, v_approved
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

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

  v_failed :=
    COALESCE((v_summary ->> 'failed')::integer, 0)
    + COALESCE((v_summary ->> 'testPublicationFailed')::integer, 0)
    + COALESCE((v_summary ->> 'liveTerminalizationFailed')::integer, 0)
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

ALTER FUNCTION private.process_due_quiz_deadline_stages_v2(boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION private.run_quiz_deadline_clock_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.process_due_quiz_deadline_stages_v2(boolean, boolean),
  private.run_quiz_deadline_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_quiz_deadlines_v2(
  boolean, boolean
) TO service_role;

COMMIT;
