-- Terminalize due live quiz attempts separately from prize publication.

BEGIN;

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
  v_failure_marked integer := 0;
  v_zero integer := 0;
BEGIN
  FOR v_event IN
    SELECT event.id FROM public.quiz_events AS event
    WHERE event.contract_version = 2 AND event.mode = 'live'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
    ORDER BY event.ends_at LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.terminalize_quiz_event_attempts_v2(
        v_event.id, pg_catalog.clock_timestamp()
      );
      UPDATE public.quiz_events
      SET attempts_terminalized_at = COALESCE(
            attempts_terminalized_at, pg_catalog.clock_timestamp()
          ),
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
        SELECT 1 FROM public.quiz_attempts WHERE event_id = v_event.id
      ) THEN v_zero := v_zero + 1; END IF;
      v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code = 'live_attempt_terminalization_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id
          AND (
            finalization_state IS DISTINCT FROM 'blocked'
            OR finalization_error_code IS DISTINCT FROM
              'live_attempt_terminalization_failed'
          );
        GET DIAGNOSTICS v_failure_marked = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        v_failure_marked := 0;
      END;
      IF v_failure_marked > 0 THEN
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
    'liveTerminalized', v_closed,
    'liveZeroPlayerClosed', v_zero,
    'liveTerminalizationFailed', v_failed
  );
END;
$$;

ALTER FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.terminalize_due_live_quiz_events_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
