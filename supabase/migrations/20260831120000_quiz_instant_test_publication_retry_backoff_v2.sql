-- Keep fresh test deadlines ahead of retries while preventing a persistently
-- failing test event from consuming every one-second clock tick.

BEGIN;

CREATE INDEX IF NOT EXISTS quiz_events_v2_test_publication_retry_idx
  ON public.quiz_events(updated_at, ends_at)
  WHERE contract_version = 2
    AND mode = 'test'
    AND status IN ('active', 'scheduled')
    AND finalization_error_code = 'test_result_publication_failed';

CREATE OR REPLACE FUNCTION private.finalize_due_test_quiz_events_clock_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event record;
  v_attempts integer;
  v_closed integer := 0;
  v_failed integer := 0;
  v_ranked integer;
  v_should_log_failure boolean;
  v_zero integer := 0;
BEGIN
  FOR v_event IN
    SELECT
      event.id,
      event.finalization_state,
      event.finalization_error_code
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'test'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'test_result_publication_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY
      (event.finalization_error_code =
        'test_result_publication_failed') NULLS FIRST,
      event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_attempts := private.terminalize_quiz_event_attempts_v2(
        v_event.id, pg_catalog.clock_timestamp()
      );
      v_ranked := private.materialize_quiz_event_results_v2(v_event.id);
      UPDATE public.quiz_events
      SET status = 'completed',
          attempts_terminalized_at = COALESCE(
            attempts_terminalized_at, pg_catalog.clock_timestamp()
          ),
          finalization_state = 'test_published',
          finalization_error_code = NULL,
          award_finalized_at = COALESCE(
            award_finalized_at, pg_catalog.clock_timestamp()
          ),
          results_published_at = COALESCE(
            results_published_at, pg_catalog.clock_timestamp()
          ),
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      INSERT INTO public.leaderboard_refresh_log(
        event_id, refresh_reason, status, details
      ) VALUES (
        v_event.id, 'quiz_v2_test_finalized', 'succeeded',
        pg_catalog.jsonb_build_object(
          'rankedParticipants', v_ranked,
          'terminalizedAttempts', v_attempts
        )
      );
      IF v_ranked = 0 THEN v_zero := v_zero + 1; END IF;
      v_closed := v_closed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure :=
        v_event.finalization_state IS DISTINCT FROM 'blocked'
        OR v_event.finalization_error_code IS DISTINCT FROM
          'test_result_publication_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code = 'test_result_publication_failed',
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
            v_event.id, 'quiz_v2_test_finalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'test_result_publication_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'testClosed', v_closed,
    'testZeroPlayerClosed', v_zero,
    'testPublicationFailed', v_failed
  );
END;
$$;

ALTER FUNCTION private.finalize_due_test_quiz_events_clock_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_due_test_quiz_events_clock_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
