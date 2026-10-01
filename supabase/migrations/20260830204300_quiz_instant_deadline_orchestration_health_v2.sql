-- Isolate deadline stages, persist a low-write health signal, and make pg_cron
-- run the same gated publication pipeline as the service-role fallback.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quiz_deadline_clock_health_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_run_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  last_failure_count integer NOT NULL DEFAULT 0
    CHECK (last_failure_count >= 0),
  last_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.quiz_deadline_clock_health_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role reads quiz deadline clock health v2"
  ON public.quiz_deadline_clock_health_v2;
CREATE POLICY "service role reads quiz deadline clock health v2"
  ON public.quiz_deadline_clock_health_v2
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.quiz_deadline_clock_health_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quiz_deadline_clock_health_v2 TO service_role;

CREATE OR REPLACE FUNCTION private.promote_due_scheduled_quiz_events_clock_v2()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.quiz_events
  SET status = 'active',
      updated_at = pg_catalog.clock_timestamp()
  WHERE contract_version = 2
    AND status = 'scheduled'
    AND starts_at <= pg_catalog.clock_timestamp()
    AND ends_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
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
  v_promoted integer := 0;
  v_promotion_failed integer := 0;
  v_deadline_failed integer := 0;
  v_live_failed integer := 0;
  v_deadlines jsonb := '{}'::jsonb;
  v_awards jsonb := '{}'::jsonb;
BEGIN
  BEGIN
    v_promoted := private.promote_due_scheduled_quiz_events_clock_v2();
  EXCEPTION WHEN OTHERS THEN
    v_promotion_failed := 1;
  END;

  BEGIN
    v_deadlines := COALESCE(
      private.process_quiz_deadline_clock_v2(), '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_deadline_failed := 1;
  END;

  BEGIN
    v_awards := COALESCE(
      public.finalize_due_live_quiz_events_v2(
        p_production_phase, p_production_approved
      ),
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_live_failed := 1;
  END;

  RETURN pg_catalog.jsonb_build_object(
    'scheduledPromoted', v_promoted,
    'scheduledPromotionFailed', v_promotion_failed,
    'deadlineClockFailed', v_deadline_failed,
    'liveFinalizationFailed', v_live_failed
  ) || v_deadlines || v_awards;
END;
$$;

CREATE OR REPLACE FUNCTION private.run_quiz_deadline_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_summary jsonb;
  v_failed integer;
BEGIN
  BEGIN
    v_summary := COALESCE(
      public.process_due_quiz_deadlines_v2(true, true), '{}'::jsonb
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

ALTER FUNCTION private.promote_due_scheduled_quiz_events_clock_v2()
  OWNER TO postgres;
ALTER FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  OWNER TO postgres;
ALTER FUNCTION private.run_quiz_deadline_clock_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.promote_due_scheduled_quiz_events_clock_v2(),
  private.run_quiz_deadline_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_due_quiz_deadlines_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_quiz_deadlines_v2(
  boolean, boolean
) TO service_role;

COMMIT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'quiz-deadline-clock-v2'
    ) THEN
      PERFORM cron.unschedule('quiz-deadline-clock-v2');
    END IF;
    PERFORM cron.schedule(
      'quiz-deadline-clock-v2', '1 second',
      'SELECT private.run_quiz_deadline_clock_v2()'
    );
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'quiz-deadline-clock-v2-log-retention'
    ) THEN
      PERFORM cron.unschedule('quiz-deadline-clock-v2-log-retention');
    END IF;
    PERFORM cron.schedule(
      'quiz-deadline-clock-v2-log-retention', '17 3 * * *',
      $cleanup$
        DELETE FROM cron.job_run_details
        WHERE command IN (
          'SELECT private.process_quiz_deadline_clock_v2()',
          'SELECT private.run_quiz_deadline_clock_v2()'
        )
          AND end_time < pg_catalog.clock_timestamp() - interval '2 days'
      $cleanup$
    );
  END IF;
END;
$$;
