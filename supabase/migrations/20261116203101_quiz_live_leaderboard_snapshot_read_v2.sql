-- Serve the live quiz leaderboard from a shared snapshot (part 2 of 3).
--
-- Replaces the live board read function so it uses the snapshot created in
-- 20261116203100; the reasoning is in that file's header. The participant
-- count function follows in 20261116203102.
--
-- get_quiz_live_leaderboard_public_v2 keeps its JSON shape and adds one key,
-- participant_count. A caller in the stored top 100 gets their stored entry,
-- so their rank is as old as the snapshot (up to 2 seconds). Any other
-- caller's rank is the number of players with a higher score (from the stored
-- histogram) plus an index range scan inside the caller's own score bucket.
-- Either way this is a provisional board: final ranks and prizes come only
-- from quiz_event_results_v2.
--
-- Names are as old as the snapshot too. The rules that replace a name with an
-- alias (deleted customer, suppressed identity, blank username) are applied
-- when the snapshot is built, not on every call as before. A suppression or
-- deletion therefore reaches the board at the next rebuild: within about 2
-- seconds while anyone is polling, and not until a rebuild succeeds if
-- rebuilds are failing (each failure logs QUIZ_LIVE_SNAPSHOT_REFRESH_FAILED).

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
    -- Unlike the stale rebuild below, a failure here is not caught: there is
    -- no earlier snapshot to serve, and an empty board with a rank computed
    -- from nothing would be wrong, so the request fails and the app retries.
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

  -- Names are served as stored: the refresher applied the alias rules, so a
  -- new suppression or deletion shows at the next rebuild (see the header).
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
  -- row and "your position" always agree with each other. Both are as old as
  -- the snapshot (up to 2 seconds), not live. Ids are compared as text so a
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
      -- Only the refresher writes the histogram, but a stored key or count
      -- that is not a whole number is skipped rather than failing a cast and
      -- taking the whole board down. CASE fixes the order: test, then cast.
      -- Keys are read as bigint so every possible integer score, negative
      -- or ten digits long, is still counted.
      SELECT COALESCE(pg_catalog.sum(bucket.players), 0)
      INTO v_ahead
      FROM (
        SELECT
          CASE WHEN raw.key ~ '^-?[0-9]{1,18}$' THEN raw.key::bigint END
            AS score,
          CASE WHEN raw.value ~ '^[0-9]{1,18}$' THEN raw.value::bigint END
            AS players
        FROM pg_catalog.jsonb_each_text(v_snapshot.score_counts) AS raw
      ) AS bucket
      WHERE bucket.score > v_mine.score;

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

COMMIT;
