-- Back off persistently failing live terminalization while keeping its retry
-- backlog visible as degraded deadline-clock health.

BEGIN;

CREATE INDEX IF NOT EXISTS quiz_events_v2_live_terminal_retry_idx
  ON public.quiz_events(updated_at, ends_at)
  WHERE contract_version = 2
    AND mode = 'live'
    AND status IN ('active', 'scheduled')
    AND attempts_terminalized_at IS NULL
    AND finalization_error_code = 'live_attempt_terminalization_failed';

CREATE OR REPLACE FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event record;
  v_closed integer := 0;
  v_failed integer := 0;
  v_retry_waiting integer := 0;
  v_should_log_failure boolean;
  v_zero integer := 0;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_retry_waiting
  FROM public.quiz_events AS event
  WHERE event.contract_version = 2
    AND event.mode = 'live'
    AND event.status IN ('active', 'scheduled')
    AND event.ends_at <= pg_catalog.clock_timestamp()
    AND event.attempts_terminalized_at IS NULL
    AND event.finalization_error_code =
      'live_attempt_terminalization_failed'
    AND event.updated_at >
      pg_catalog.clock_timestamp() - interval '30 seconds';

  FOR v_event IN
    SELECT event.id, event.finalization_error_code
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NULL
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'live_attempt_terminalization_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY
      (event.finalization_error_code =
        'live_attempt_terminalization_failed') NULLS FIRST,
      event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.terminalize_quiz_event_attempts_v2(
        v_event.id, pg_catalog.clock_timestamp()
      );
      UPDATE public.quiz_events
      SET attempts_terminalized_at = pg_catalog.clock_timestamp(),
          finalization_state = CASE
            WHEN finalization_state IN ('awarded', 'no_winner')
              THEN finalization_state
            ELSE 'pending'
          END,
          finalization_error_code = CASE
            WHEN finalization_state IN ('awarded', 'no_winner')
              THEN finalization_error_code
            ELSE NULL
          END,
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      IF NOT EXISTS (
        SELECT 1 FROM public.quiz_attempts
        WHERE event_id = v_event.id
      ) THEN
        v_zero := v_zero + 1;
      END IF;
      v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure :=
        v_event.finalization_error_code IS DISTINCT FROM
          'live_attempt_terminalization_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code =
              'live_attempt_terminalization_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
      EXCEPTION WHEN OTHERS THEN
        v_should_log_failure := false;
      END;
      IF v_should_log_failure THEN
        BEGIN
          INSERT INTO public.leaderboard_refresh_log(
            event_id, refresh_reason, status, details
          ) VALUES (
            v_event.id, 'quiz_v2_live_terminalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'live_attempt_terminalization_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'liveTerminalizationFailed', v_failed,
    'liveTerminalizationRetryPending', v_retry_waiting,
    'liveTerminalized', v_closed,
    'liveZeroPlayerClosed', v_zero
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
    COALESCE((v_summary ->> 'failed')::integer, 0)
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

ALTER FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
  OWNER TO postgres;
ALTER FUNCTION private.run_quiz_deadline_clock_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.terminalize_due_live_quiz_events_clock_v2(),
  private.run_quiz_deadline_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
