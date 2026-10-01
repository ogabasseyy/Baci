-- Bound the per-second live backlog scan to unpublished due candidates and
-- keep retry-backoff awards visible as degraded until they recover.

BEGIN;

CREATE INDEX IF NOT EXISTS quiz_events_v2_live_unpublished_due_idx
  ON public.quiz_events(ends_at, updated_at)
  WHERE contract_version = 2
    AND mode = 'live'
    AND attempts_terminalized_at IS NOT NULL
    AND finalization_state IN ('pending', 'blocked')
    AND results_published_at IS NULL;

CREATE OR REPLACE FUNCTION public.finalize_due_live_quiz_events_v2(
  p_production_phase boolean,
  p_production_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_winner public.quiz_event_results_v2%ROWTYPE;
  v_awarded integer := 0;
  v_none integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_outcome text;
  v_retry_waiting integer := 0;
  v_should_log_failure boolean;
BEGIN
  WITH blocked_event AS (
    SELECT event.id
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state IN ('pending', 'blocked')
      AND event.results_published_at IS NULL
      AND NOT (
        p_production_phase IS TRUE
        AND p_production_approved IS TRUE
        AND private.quiz_live_prize_regulatory_ready_v2(event.id)
        AND event.claim_window_seconds IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.quiz_prize_reservations AS reservation
          WHERE reservation.event_id = event.id
            AND reservation.state = 'reserved'
        )
      )
      AND (
        event.finalization_state IS DISTINCT FROM 'blocked'
        OR event.finalization_error_code IS DISTINCT FROM
          'live_award_gate_unavailable'
      )
    ORDER BY event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.quiz_events AS event
  SET finalization_state = 'blocked',
      finalization_error_code = 'live_award_gate_unavailable',
      updated_at = pg_catalog.clock_timestamp()
  FROM blocked_event
  WHERE event.id = blocked_event.id;

  SELECT pg_catalog.count(*)::integer
  INTO v_blocked
  FROM public.quiz_events AS event
  WHERE event.contract_version = 2
    AND event.mode = 'live'
    AND event.ends_at <= pg_catalog.clock_timestamp()
    AND event.attempts_terminalized_at IS NOT NULL
    AND event.finalization_state IN ('pending', 'blocked')
    AND event.results_published_at IS NULL
    AND NOT (
      p_production_phase IS TRUE
      AND p_production_approved IS TRUE
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      )
    );

  IF p_production_phase IS TRUE
    AND p_production_approved IS TRUE THEN
    SELECT pg_catalog.count(*)::integer
    INTO v_retry_waiting
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state = 'blocked'
      AND event.results_published_at IS NULL
      AND event.finalization_error_code = 'live_award_transfer_failed'
      AND event.updated_at >
        pg_catalog.clock_timestamp() - interval '30 seconds'
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      );
  END IF;

  IF p_production_phase IS NOT TRUE
    OR p_production_approved IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'awarded', v_awarded,
      'failed', v_failed,
      'liveAwardRetryPending', v_retry_waiting,
      'liveAwaitingGate', v_blocked,
      'noWinner', v_none
    );
  END IF;

  FOR v_event IN
    SELECT event.*
    FROM public.quiz_events AS event
    WHERE event.contract_version = 2
      AND event.mode = 'live'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state IN ('pending', 'blocked')
      AND event.results_published_at IS NULL
      AND private.quiz_live_prize_regulatory_ready_v2(event.id)
      AND event.claim_window_seconds IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = event.id
          AND reservation.state = 'reserved'
      )
      AND (
        event.finalization_error_code IS DISTINCT FROM
          'live_award_transfer_failed'
        OR event.updated_at <=
          pg_catalog.clock_timestamp() - interval '30 seconds'
      )
    ORDER BY (event.finalization_state = 'blocked'), event.ends_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.materialize_quiz_event_results_v2(v_event.id);
      SELECT result.*
      INTO v_winner
      FROM public.quiz_event_results_v2 AS result
      WHERE result.event_id = v_event.id
        AND result.rank = 1;

      IF v_winner.attempt_id IS NULL THEN
        PERFORM private.release_quiz_prize_reservation_v2(
          v_event.id, 'no_eligible_winner'
        );
        UPDATE public.quiz_events
        SET status = 'completed',
            finalization_state = 'no_winner',
            finalization_error_code = NULL,
            award_finalized_at = pg_catalog.clock_timestamp(),
            results_published_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_none := v_none + 1;
        v_outcome := 'no_winner';
      ELSE
        PERFORM private.transfer_quiz_prize_to_winner_v2(
          v_event.id, v_winner.attempt_id, v_winner.customer_id
        );
        UPDATE public.quiz_events
        SET status = 'completed',
            finalization_state = 'awarded',
            finalization_error_code = NULL,
            award_finalized_at = pg_catalog.clock_timestamp(),
            results_published_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_awarded := v_awarded + 1;
        v_outcome := 'awarded';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_should_log_failure := v_event.finalization_error_code IS DISTINCT FROM
        'live_award_transfer_failed';
      BEGIN
        UPDATE public.quiz_events
        SET finalization_state = 'blocked',
            finalization_error_code = 'live_award_transfer_failed',
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      IF v_should_log_failure THEN
        BEGIN
          INSERT INTO public.leaderboard_refresh_log(
            event_id, refresh_reason, status, details
          ) VALUES (
            v_event.id, 'quiz_v2_live_finalized', 'failed',
            pg_catalog.jsonb_build_object(
              'code', 'live_award_transfer_failed'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
      CONTINUE;
    END;

    BEGIN
      INSERT INTO public.leaderboard_refresh_log(
        event_id, refresh_reason, status, details
      ) VALUES (
        v_event.id, 'quiz_v2_live_finalized', 'succeeded',
        pg_catalog.jsonb_build_object('outcome', v_outcome)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'awarded', v_awarded,
    'failed', v_failed,
    'liveAwardRetryPending', v_retry_waiting,
    'liveAwaitingGate', v_blocked + v_retry_waiting + v_failed,
    'noWinner', v_none
  );
END;
$$;

ALTER FUNCTION public.finalize_due_live_quiz_events_v2(boolean, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_due_live_quiz_events_v2(
  boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_live_quiz_events_v2(
  boolean, boolean
) TO service_role;

COMMIT;
