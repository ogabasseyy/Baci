-- Compute final quiz standings once at publication time. Player-facing reads
-- then stay bounded even when an event has a very large participant count.

CREATE TABLE IF NOT EXISTS public.quiz_event_results_v2 (
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  rank bigint NOT NULL CHECK (rank > 0),
  score integer NOT NULL CHECK (score >= 0),
  total_time_seconds double precision NOT NULL CHECK (total_time_seconds >= 0),
  submitted_at timestamptz NOT NULL,
  leaderboard_username text,
  attempt_status text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id, attempt_id)
);

-- Production may already contain the millisecond column from the later
-- tie-break migration while this historical migration is still pending. Make
-- the snapshot contract compatible with both that drifted state and a clean
-- database before the published-event backfill runs.
ALTER TABLE public.quiz_event_results_v2
  ADD COLUMN IF NOT EXISTS total_time_milliseconds bigint;

UPDATE public.quiz_event_results_v2
SET total_time_milliseconds = pg_catalog.floor(total_time_seconds * 1000)::bigint
WHERE total_time_milliseconds IS NULL;

ALTER TABLE public.quiz_event_results_v2
  ALTER COLUMN total_time_milliseconds SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_event_results_v2_event_rank_uidx
  ON public.quiz_event_results_v2 (event_id, rank);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_event_results_v2_event_customer_uidx
  ON public.quiz_event_results_v2 (event_id, customer_id);
CREATE INDEX IF NOT EXISTS quiz_event_results_v2_attempt_idx
  ON public.quiz_event_results_v2 (attempt_id);
CREATE INDEX IF NOT EXISTS quiz_event_results_v2_customer_idx
  ON public.quiz_event_results_v2 (customer_id);

ALTER TABLE public.quiz_event_results_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_event_results_v2 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.materialize_quiz_event_results_v2(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.quiz_event_results_v2 WHERE event_id = p_event_id;

  INSERT INTO public.quiz_event_results_v2 (
    event_id, attempt_id, customer_id, rank, score, total_time_seconds,
    total_time_milliseconds, submitted_at, leaderboard_username, attempt_status
  )
  SELECT p_event_id, ranked.attempt_id, ranked.customer_id, ranked.rank,
    ranked.score, ranked.total_time_seconds,
    pg_catalog.floor(ranked.total_time_seconds * 1000)::bigint,
    attempt.submitted_at,
    attempt.leaderboard_username, attempt.status
  FROM private.quiz_ranked_candidates_v2(p_event_id) AS ranked
  JOIN public.quiz_attempts AS attempt ON attempt.id = ranked.attempt_id
  ORDER BY ranked.rank;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_due_test_quiz_events_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event record;
  v_closed integer := 0;
  v_zero integer := 0;
  v_attempts integer;
  v_ranked integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_event IN
    SELECT event.id FROM public.quiz_events AS event
    WHERE event.contract_version = 2 AND event.mode = 'test'
      AND event.status IN ('active', 'scheduled')
      AND event.ends_at <= pg_catalog.clock_timestamp()
    ORDER BY event.ends_at LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    v_attempts := private.terminalize_quiz_event_attempts_v2(v_event.id, pg_catalog.clock_timestamp());
    v_ranked := private.materialize_quiz_event_results_v2(v_event.id);
    IF v_ranked = 0 THEN v_zero := v_zero + 1; END IF;
    UPDATE public.quiz_events
    SET status = 'completed',
        attempts_terminalized_at = COALESCE(attempts_terminalized_at, pg_catalog.clock_timestamp()),
        finalization_state = 'test_published', finalization_error_code = NULL,
        award_finalized_at = COALESCE(award_finalized_at, pg_catalog.clock_timestamp()),
        results_published_at = COALESCE(results_published_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_event.id;
    INSERT INTO public.leaderboard_refresh_log(event_id, refresh_reason, status, details)
    VALUES (v_event.id, 'quiz_v2_test_finalized', 'succeeded',
      pg_catalog.jsonb_build_object('rankedParticipants', v_ranked, 'terminalizedAttempts', v_attempts));
    v_closed := v_closed + 1;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('testClosed', v_closed, 'zeroPlayerClosed', v_zero);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_leaderboard_public_v2(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_customer_id uuid;
  v_entries jsonb;
  v_current_player jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT event.* INTO v_event FROM public.quiz_events AS event WHERE event.id = p_event_id;
  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable', 'entries', '[]'::jsonb, 'current_player', NULL);
  END IF;
  SELECT customer.id INTO v_customer_id FROM public.customers AS customer
  WHERE customer.merchant_id = v_event.merchant_id AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL LIMIT 1;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  IF v_event.mode = 'test' AND NOT (
    public.has_merchant_access(v_event.merchant_id) OR EXISTS (
      SELECT 1 FROM public.quiz_event_testers AS tester
      WHERE tester.event_id = v_event.id AND tester.user_id = auth.uid() AND tester.revoked_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  IF v_event.mode = 'live' AND NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  IF v_event.status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable', 'entries', '[]'::jsonb, 'current_player', NULL);
  END IF;
  IF v_event.results_published_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'live_hidden', 'entries', '[]'::jsonb, 'current_player', NULL);
  END IF;

  WITH projected AS (
    SELECT result.rank, result.customer_id,
      pg_catalog.jsonb_build_object(
        'customer_name', CASE
          WHEN customer.deleted_at IS NOT NULL OR suppression.id IS NOT NULL
            OR NULLIF(pg_catalog.btrim(result.leaderboard_username), '') IS NULL
          THEN private.quiz_public_leaderboard_alias(v_event.id, result.customer_id)
          ELSE pg_catalog.btrim(result.leaderboard_username)
        END,
        'is_current_customer', result.customer_id = v_customer_id,
        'rank', result.rank, 'score', result.score,
        'status', result.attempt_status, 'submitted_at', result.submitted_at,
        'total_time_seconds', result.total_time_seconds
      ) AS entry
    FROM public.quiz_event_results_v2 AS result
    LEFT JOIN public.customers AS customer ON customer.id = result.customer_id
    LEFT JOIN public.quiz_leaderboard_identity_suppressions AS suppression
      ON suppression.attempt_id = result.attempt_id
    WHERE result.event_id = v_event.id
      AND (result.rank <= 100 OR result.customer_id = v_customer_id)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(entry ORDER BY rank) FILTER (WHERE rank <= 100), '[]'::jsonb),
    (pg_catalog.jsonb_agg(entry ORDER BY rank) FILTER (WHERE customer_id = v_customer_id AND rank > 100))->0
  INTO v_entries, v_current_player FROM projected;
  RETURN pg_catalog.jsonb_build_object('status', 'published', 'entries', v_entries, 'current_player', v_current_player);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_leaderboard_participant_count_v2(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_projection jsonb;
BEGIN
  v_projection := public.get_quiz_leaderboard_public_v2(p_event_id);
  IF v_projection->>'status' <> 'published' THEN RETURN 0; END IF;
  RETURN (SELECT pg_catalog.count(*)::integer FROM public.quiz_event_results_v2 WHERE event_id = p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_attempt_result_v2(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_event public.quiz_events%ROWTYPE;
  v_result public.quiz_event_results_v2%ROWTYPE;
  v_award public.quiz_awards%ROWTYPE;
  v_claim_metadata jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT attempt.* INTO v_attempt FROM public.quiz_attempts AS attempt
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id AND customer.user_id = auth.uid() AND customer.deleted_at IS NULL;
  IF v_attempt.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'availability', 'unavailable', 'reason', 'not_found');
  END IF;
  SELECT event.* INTO v_event FROM public.quiz_events AS event WHERE event.id = v_attempt.event_id;
  IF v_event.status = 'cancelled' OR v_attempt.status = 'event_cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('attemptId', v_attempt.id, 'availability', 'unavailable', 'reason', 'event_cancelled');
  END IF;
  IF v_attempt.status = 'tester_revoked' THEN
    RETURN pg_catalog.jsonb_build_object('attemptId', v_attempt.id, 'availability', 'unavailable', 'reason', 'tester_revoked');
  END IF;
  IF v_event.results_published_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('attemptId', v_attempt.id, 'availability', 'pending', 'availableAt', v_event.ends_at);
  END IF;
  SELECT result.* INTO v_result FROM public.quiz_event_results_v2 AS result
  WHERE result.event_id = v_event.id AND result.attempt_id = v_attempt.id;
  IF v_result.attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('attemptId', v_attempt.id, 'availability', 'unavailable');
  END IF;
  IF v_event.mode = 'live' THEN
    SELECT award.* INTO v_award FROM public.quiz_awards AS award
    WHERE award.event_id = v_event.id AND award.attempt_id = v_attempt.id
      AND award.award_source = 'ranked_product_v2' AND award.status IN ('pending', 'approved')
      AND award.claim_expires_at > pg_catalog.clock_timestamp()
    ORDER BY award.created_at LIMIT 1;
    IF v_award.id IS NOT NULL THEN
      v_claim_metadata := pg_catalog.jsonb_build_object('awardId', v_award.id, 'expiresAt', v_award.claim_expires_at);
    END IF;
  END IF;
  RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id, 'availability', 'final', 'availableAt', v_event.results_published_at,
    'score', v_result.score, 'rank', v_result.rank, 'totalQuestions', v_event.question_count,
    'claimMetadata', v_claim_metadata
  ));
END;
$$;

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
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  FOR v_event IN
    SELECT event.* FROM public.quiz_events AS event
    WHERE event.contract_version = 2 AND event.mode = 'live'
      AND event.ends_at <= pg_catalog.clock_timestamp()
      AND event.attempts_terminalized_at IS NOT NULL
      AND event.finalization_state IN ('pending', 'blocked')
      AND event.results_published_at IS NULL
    ORDER BY event.ends_at LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    IF p_production_phase IS NOT TRUE OR p_production_approved IS NOT TRUE
      OR NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id)
      OR v_event.claim_window_seconds IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.quiz_prize_reservations AS reservation
        WHERE reservation.event_id = v_event.id AND reservation.state = 'reserved'
      ) THEN
      UPDATE public.quiz_events SET finalization_state = 'blocked',
        finalization_error_code = 'live_award_gate_unavailable', updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      v_blocked := v_blocked + 1;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM private.materialize_quiz_event_results_v2(v_event.id);
      SELECT result.* INTO v_winner FROM public.quiz_event_results_v2 AS result
      WHERE result.event_id = v_event.id AND result.rank = 1;
      IF v_winner.attempt_id IS NULL THEN
        PERFORM private.release_quiz_prize_reservation_v2(v_event.id, 'no_eligible_winner');
        UPDATE public.quiz_events SET status = 'completed', finalization_state = 'no_winner',
          finalization_error_code = NULL, award_finalized_at = pg_catalog.clock_timestamp(),
          results_published_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_none := v_none + 1;
      ELSE
        PERFORM private.transfer_quiz_prize_to_winner_v2(
          v_event.id, v_winner.attempt_id, v_winner.customer_id
        );
        UPDATE public.quiz_events SET status = 'completed', finalization_state = 'awarded',
          finalization_error_code = NULL, award_finalized_at = pg_catalog.clock_timestamp(),
          results_published_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_event.id;
        v_awarded := v_awarded + 1;
      END IF;
      INSERT INTO public.leaderboard_refresh_log(event_id, refresh_reason, status, details)
      VALUES (v_event.id, 'quiz_v2_live_finalized', 'succeeded',
        pg_catalog.jsonb_build_object('outcome', CASE WHEN v_winner.attempt_id IS NULL THEN 'no_winner' ELSE 'awarded' END));
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.quiz_events SET finalization_state = 'blocked',
        finalization_error_code = 'live_award_transfer_failed', updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_event.id;
      INSERT INTO public.leaderboard_refresh_log(event_id, refresh_reason, status, details)
      VALUES (v_event.id, 'quiz_v2_live_finalized', 'failed',
        pg_catalog.jsonb_build_object('code', 'live_award_transfer_failed'));
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('awarded', v_awarded, 'failed', v_failed,
    'liveAwaitingGate', v_blocked + v_failed, 'noWinner', v_none);
END;
$$;

REVOKE ALL ON FUNCTION private.materialize_quiz_event_results_v2(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_due_test_quiz_events_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_test_quiz_events_v2() TO service_role;
REVOKE ALL ON FUNCTION public.finalize_due_live_quiz_events_v2(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_live_quiz_events_v2(boolean, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.get_quiz_leaderboard_public_v2(uuid),
  public.get_quiz_leaderboard_participant_count_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_leaderboard_public_v2(uuid),
  public.get_quiz_leaderboard_participant_count_v2(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_quiz_attempt_result_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_result_v2(uuid) TO authenticated, service_role;

-- Existing published events predate the snapshot table. Backfill them once so
-- past leaderboards remain available immediately after this migration lands.
DO $$
DECLARE
  v_event record;
BEGIN
  FOR v_event IN
    SELECT event.id FROM public.quiz_events AS event
    WHERE event.contract_version = 2 AND event.results_published_at IS NOT NULL
    ORDER BY event.results_published_at
  LOOP
    PERFORM private.materialize_quiz_event_results_v2(v_event.id);
  END LOOP;
END;
$$;
