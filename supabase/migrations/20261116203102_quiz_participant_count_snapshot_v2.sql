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
-- Published event: the number of result rows, as the function it replaces
-- returned, but counted at most once a minute instead of on every call.
-- Results and results_published_at are written in one transaction, so the
-- first read after publication sees every ranked row. The count is stored in
-- the snapshot row with the time it was taken; reads within the next minute
-- are one primary-key lookup, at the moment every phone loads the final
-- board. The first count after publication is single flight too, through a
-- transaction advisory lock: requests that find no stored number wait (at
-- most this function's 2-second lock_timeout) for the one that is counting
-- and use its result. After a minute one request recounts the same way while
-- the others keep returning the stored number. Every request that takes the
-- lock reads the stored number again first, so a request that saw it expired
-- does not recount right after another refreshed it. So a repair that
-- re-ranks a published event, or a deleted account whose row cascades away,
-- shows within a minute with no manual step. If the
-- event has no snapshot row yet (its live board was never built), the count
-- is stored in a placeholder row whose computed_at is -infinity; the board
-- function treats that as "no board yet" and builds a real one on its first
-- call.
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
SET lock_timeout = '2s'
AS $$
DECLARE
  v_checked_at timestamptz;
  v_count integer;
  v_customer_id uuid;
  v_event public.quiz_events%ROWTYPE;
  v_lock_key bigint;
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
    SELECT snapshot.published_participant_count,
      snapshot.published_count_checked_at
    INTO v_count, v_checked_at
    FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
    WHERE snapshot.event_id = p_event_id;
    IF v_count IS NOT NULL
      AND v_checked_at >= pg_catalog.clock_timestamp() - interval '60 seconds' THEN
      RETURN v_count;
    END IF;
    -- Nothing stored yet, or due for a recount: one request counts.
    v_lock_key := pg_catalog.hashtextextended(
      'quiz_published_participant_count_v2:' || p_event_id::text, 0
    );
    IF v_count IS NOT NULL THEN
      -- A number is on file, so the requests that lose the lock keep
      -- returning it instead of all counting at once.
      IF NOT pg_catalog.pg_try_advisory_xact_lock(v_lock_key) THEN
        RETURN v_count;
      END IF;
    ELSE
      -- No number on file: the first reads after publication, when every
      -- phone loads the final board. Wait for the request that is counting
      -- instead of all counting and writing the same row. The wait is
      -- bounded by this function's lock_timeout; a request that times out
      -- counts for itself rather than failing the read.
      BEGIN
        PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
      EXCEPTION WHEN lock_not_available THEN
        NULL;
      END;
    END IF;
    -- Another request may have stored a count while this one waited, or
    -- between the read above and the lock. Use it when it is current.
    SELECT snapshot.published_participant_count,
      snapshot.published_count_checked_at
    INTO v_count, v_checked_at
    FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
    WHERE snapshot.event_id = p_event_id;
    IF v_count IS NOT NULL
      AND v_checked_at >= pg_catalog.clock_timestamp() - interval '60 seconds' THEN
      RETURN v_count;
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.quiz_event_results_v2 AS result
    WHERE result.event_id = p_event_id;
    -- Store the count with its time, creating a placeholder row when no
    -- board was ever built. A failed or slow write (this function's own
    -- 2-second lock_timeout) must not fail the read. (A statement timeout is
    -- not caught by OTHERS and still ends the request.)
    BEGIN
      INSERT INTO public.quiz_live_leaderboard_snapshots_v2 AS snapshot (
        event_id, entries, score_counts, participant_count, computed_at,
        published_participant_count, published_count_checked_at
      ) VALUES (
        p_event_id, '[]'::jsonb, '{}'::jsonb, 0, '-infinity'::timestamptz,
        v_count, pg_catalog.clock_timestamp()
      )
      ON CONFLICT (event_id) DO UPDATE
      SET published_participant_count = EXCLUDED.published_participant_count,
          published_count_checked_at = EXCLUDED.published_count_checked_at;
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
