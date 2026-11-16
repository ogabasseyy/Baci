-- Serve the live quiz leaderboard from a shared snapshot (part 3 of 3).
--
-- Replaces get_quiz_participant_count_public_v2 so it no longer counts every
-- row on every call; the reasoning is in 20261116203100's header.
--
-- Live event: the count stored in the snapshot when that is at most 10
-- seconds old, otherwise an exact count of the live standings. The board
-- function rebuilds the snapshot once it is 2 seconds old, but this function
-- never rebuilds it, and its callers may be the only ones around (a waiting
-- room). Accepting a 10-second-old count keeps them off the full count as
-- long as anybody is looking at the board. The difference is intended: for
-- those few seconds this count and the board's own participant_count can
-- differ by the players who finished in between.
--
-- Published event: the number of players ranked at publication. Results and
-- results_published_at are written in one transaction, so the first read
-- after publication sees every ranked row. That read counts them once and
-- stores the number in the snapshot row; every later read is one primary-key
-- lookup, at the moment every phone loads the final board. The stored number
-- does not change when a ranked player's row is deleted later (ON DELETE
-- CASCADE), whichever rank they held: they still took part. Two limits: an
-- event with no snapshot row (nobody ever opened its live board) stores
-- nothing and counts the result rows on each call; and a manual repair that
-- re-ranks a published event must clear published_participant_count.
--
-- Access is the same as in the function this replaces: any signed-in
-- customer of the event's merchant. That has always been a lighter gate than
-- the board's (tester access, regulatory readiness); neither is changed here.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_quiz_participant_count_public_v2(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_customer_id uuid;
  v_event public.quiz_events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT event.* INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id;
  SELECT customer.id INTO v_customer_id
  FROM public.customers AS customer
  WHERE customer.merchant_id = v_event.merchant_id
    AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL
  LIMIT 1;
  IF v_event.id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  IF v_event.status = 'cancelled' THEN
    RETURN 0;
  END IF;
  IF v_event.results_published_at IS NOT NULL THEN
    SELECT snapshot.published_participant_count INTO v_count
    FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
    WHERE snapshot.event_id = p_event_id;
    IF v_count IS NOT NULL THEN
      RETURN v_count;
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.quiz_event_results_v2 AS result
    WHERE result.event_id = p_event_id;
    -- Keep the first count. Concurrent first readers queue on the row and the
    -- later ones change nothing. A failed write must not fail the read. (A
    -- statement timeout is not caught by OTHERS and still ends the request.)
    BEGIN
      UPDATE public.quiz_live_leaderboard_snapshots_v2 AS snapshot
      SET published_participant_count = v_count
      WHERE snapshot.event_id = p_event_id
        AND snapshot.published_participant_count IS NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'QUIZ_PUBLISHED_COUNT_STORE_FAILED sqlstate=%', SQLSTATE;
    END;
    RETURN v_count;
  END IF;

  SELECT snapshot.participant_count INTO v_count
  FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
  WHERE snapshot.event_id = p_event_id
    AND snapshot.computed_at
      >= pg_catalog.clock_timestamp() - interval '10 seconds';
  IF FOUND THEN
    RETURN v_count;
  END IF;
  RETURN (
    SELECT pg_catalog.count(*)::integer
    FROM public.quiz_live_standings_v2 AS live
    WHERE live.event_id = p_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_participant_count_public_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_participant_count_public_v2(uuid)
  TO authenticated;

COMMIT;
