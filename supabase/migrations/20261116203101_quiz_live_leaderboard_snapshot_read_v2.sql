-- Serve the live quiz leaderboard from a shared snapshot (part 2 of 2).
--
-- Replaces the two read functions so they use the snapshot created in
-- 20261116203100; the reasoning is in that file's header.
--
-- get_quiz_live_leaderboard_public_v2 keeps its JSON shape and adds one key,
-- participant_count. A caller's own rank is the number of players with a
-- higher score (from the stored histogram) plus an index range scan inside
-- the caller's own score bucket.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_quiz_live_leaderboard_public_v2(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ahead bigint;
  v_current jsonb;
  v_customer_id uuid;
  v_entries jsonb;
  v_event public.quiz_events%ROWTYPE;
  v_lock_key bigint;
  v_mine public.quiz_live_standings_v2%ROWTYPE;
  v_snapshot public.quiz_live_leaderboard_snapshots_v2%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT event.* INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id;
  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  IF v_event.mode = 'test' AND NOT (
    public.has_merchant_access(v_event.merchant_id) OR EXISTS (
      SELECT 1 FROM public.quiz_event_testers AS tester
      WHERE tester.event_id = v_event.id
        AND tester.user_id = auth.uid()
        AND tester.revoked_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  IF v_event.mode = 'live'
    AND NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  SELECT customer.id INTO v_customer_id
  FROM public.customers AS customer
  WHERE customer.merchant_id = v_event.merchant_id
    AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL
  LIMIT 1;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;

  SELECT snapshot.* INTO v_snapshot
  FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
  WHERE snapshot.event_id = p_event_id;

  v_lock_key := pg_catalog.hashtextextended(
    'quiz_live_leaderboard_snapshot_v2:' || p_event_id::text, 0
  );
  IF v_snapshot.event_id IS NULL THEN
    -- First reader of this event: wait for whoever is building the first
    -- snapshot instead of showing an empty board, then build it if nobody did.
    PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
    SELECT snapshot.* INTO v_snapshot
    FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
    WHERE snapshot.event_id = p_event_id;
    IF v_snapshot.event_id IS NULL THEN
      PERFORM private.refresh_quiz_live_leaderboard_snapshot_v2(p_event_id);
      SELECT snapshot.* INTO v_snapshot
      FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
      WHERE snapshot.event_id = p_event_id;
    END IF;
  ELSIF v_snapshot.computed_at
      < pg_catalog.clock_timestamp() - interval '2 seconds'
    AND pg_catalog.pg_try_advisory_xact_lock(v_lock_key) THEN
    -- Stale and nobody else is refreshing right now. Another request may have
    -- refreshed and committed between the read above and this lock, so read
    -- again and only rebuild a row that is still stale. Requests that do not
    -- get the lock keep serving the previous snapshot.
    SELECT snapshot.* INTO v_snapshot
    FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
    WHERE snapshot.event_id = p_event_id;
    IF v_snapshot.computed_at
        < pg_catalog.clock_timestamp() - interval '2 seconds' THEN
      -- A failed rebuild must not take the board down: the row read above is
      -- still a valid, slightly older board, so keep serving it. (A statement
      -- timeout is not caught by OTHERS and still ends the request.)
      BEGIN
        PERFORM private.refresh_quiz_live_leaderboard_snapshot_v2(p_event_id);
        SELECT snapshot.* INTO v_snapshot
        FROM public.quiz_live_leaderboard_snapshots_v2 AS snapshot
        WHERE snapshot.event_id = p_event_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'QUIZ_LIVE_SNAPSHOT_REFRESH_FAILED sqlstate=%', SQLSTATE;
      END;
    END IF;
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      (item.entry - 'customer_id') || pg_catalog.jsonb_build_object(
        'is_current_customer',
        item.entry->>'customer_id' = v_customer_id::text
      )
      ORDER BY item.position
    ),
    '[]'::jsonb
  )
  INTO v_entries
  FROM pg_catalog.jsonb_array_elements(v_snapshot.entries)
    WITH ORDINALITY AS item(entry, position);

  -- A caller inside the stored top 100 reuses that entry so the highlighted
  -- row and "your position" always agree. Ids are compared as text so a
  -- stored entry can never fail a cast and take the whole board down.
  SELECT (item.entry - 'customer_id')
    || pg_catalog.jsonb_build_object('is_current_customer', true)
  INTO v_current
  FROM pg_catalog.jsonb_array_elements(v_snapshot.entries) AS item(entry)
  WHERE item.entry->>'customer_id' = v_customer_id::text
  LIMIT 1;

  IF v_current IS NULL THEN
    SELECT live.* INTO v_mine
    FROM public.quiz_live_standings_v2 AS live
    WHERE live.event_id = p_event_id
      AND live.customer_id = v_customer_id;

    IF v_mine.attempt_id IS NOT NULL THEN
      SELECT COALESCE(pg_catalog.sum(bucket.value::bigint), 0)
      INTO v_ahead
      FROM pg_catalog.jsonb_each_text(v_snapshot.score_counts) AS bucket
      WHERE bucket.key::integer > v_mine.score;

      -- Same score: only the players who beat this caller's time (then
      -- submission instant, then attempt id). Served by
      -- quiz_live_standings_v2_order_idx as one range scan.
      --
      -- This count is live while the histogram above is up to 2 seconds old,
      -- so just after other players finish the two can disagree by those few
      -- players until the next refresh. That is accepted for a provisional
      -- board: an always-consistent rank means reading every player ahead on
      -- every call, which is the cost this function exists to remove. Final
      -- ranks and prizes come only from quiz_event_results_v2.
      v_ahead := v_ahead + (
        SELECT pg_catalog.count(*)
        FROM public.quiz_live_standings_v2 AS other
        WHERE other.event_id = p_event_id
          AND other.score = v_mine.score
          AND (other.total_time_milliseconds, other.submitted_at, other.attempt_id)
            < (v_mine.total_time_milliseconds, v_mine.submitted_at, v_mine.attempt_id)
      );

      v_current := pg_catalog.jsonb_build_object(
        'customer_name', CASE
          WHEN NULLIF(pg_catalog.btrim(v_mine.leaderboard_username), '') IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.quiz_leaderboard_identity_suppressions AS suppression
              WHERE suppression.attempt_id = v_mine.attempt_id
            )
          THEN private.quiz_public_leaderboard_alias(p_event_id, v_customer_id)
          ELSE pg_catalog.btrim(v_mine.leaderboard_username)
        END,
        'is_current_customer', true,
        'rank', v_ahead + 1,
        'score', v_mine.score,
        'status', v_mine.attempt_status,
        'submitted_at', v_mine.submitted_at,
        'total_time_seconds',
          v_mine.total_time_milliseconds::double precision / 1000.0::double precision
      );
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'live',
    'entries', v_entries,
    'current_player', v_current,
    'participant_count', v_snapshot.participant_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_live_leaderboard_public_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_live_leaderboard_public_v2(uuid)
  TO authenticated;

-- The count endpoint no longer counts every row per call: a live event reads
-- the snapshot and a published event reads its highest rank.
--
-- Published contract: the count is the number of players ranked when results
-- were published. Ranks are written once as 1..N, so the highest rank is that
-- number, read with one index probe instead of a count over every row at the
-- moment every phone loads the final board. If a ranked player's account is
-- deleted later their row goes (ON DELETE CASCADE) but they still took part,
-- so the count does not drop for them. The one exception is the last-ranked
-- player: deleting that row lowers the highest rank, and the count, by one.
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
    RETURN COALESCE((
      SELECT result.rank::integer
      FROM public.quiz_event_results_v2 AS result
      WHERE result.event_id = p_event_id
      ORDER BY result.rank DESC
      LIMIT 1
    ), 0);
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
