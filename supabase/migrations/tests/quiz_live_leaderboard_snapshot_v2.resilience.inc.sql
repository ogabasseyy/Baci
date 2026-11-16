-- Included by quiz_live_leaderboard_snapshot_v2.sql after step 5, inside its
-- transaction, signed in as player 120 (rank 122 once step 5 has run).

-- 5b. A rebuild that fails must not take the board down: the previous
--     snapshot is served. The rebuild is made to fail by a temporary guard on
--     the snapshot table.
CREATE FUNCTION pg_temp.fail_snapshot_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'snapshot write refused by the regression suite';
END;
$$;
CREATE TRIGGER quiz_snapshot_regression_guard
BEFORE INSERT OR UPDATE ON public.quiz_live_leaderboard_snapshots_v2
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_snapshot_write();
SET LOCAL session_replication_role = replica;
UPDATE public.quiz_live_leaderboard_snapshots_v2
SET computed_at = pg_catalog.clock_timestamp() - interval '1 minute'
WHERE event_id = '79000000-0000-4000-8000-000000000003';
SET LOCAL session_replication_role = origin;
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
BEGIN
  PERFORM pg_temp.expect('a failed rebuild still serves the previous board',
    v_board->>'status' = 'live'
      AND pg_catalog.jsonb_array_length(v_board->'entries') = 100
      AND (v_board->>'participant_count')::integer = 153);
END;
$$;
DROP TRIGGER quiz_snapshot_regression_guard
  ON public.quiz_live_leaderboard_snapshots_v2;

-- 5c. A stored tally entry that is not a number is skipped, instead of
--     failing a cast and taking the board down for everyone outside the top
--     100, while any whole-number score still counts (4 players on a
--     ten-digit score here). v_before is read first, in DECLARE: 5b left the
--     snapshot stale, so that call rebuilds a clean one. The damaged tally is
--     then stored as fresh, so v_after has to be computed from it as stored.
DO $$
DECLARE
  v_before jsonb := pg_temp.board();
  v_after jsonb;
BEGIN
  UPDATE public.quiz_live_leaderboard_snapshots_v2
  SET score_counts = score_counts
        || '{"not-a-score": 7, "999": "many", "2000000000": 4}'::jsonb,
      computed_at = pg_catalog.clock_timestamp()
  WHERE event_id = '79000000-0000-4000-8000-000000000003';
  v_after := pg_temp.board();
  PERFORM pg_temp.expect('damaged tally entries are skipped, valid ones count',
    (v_before->'current_player'->>'rank')::integer = 122
      AND (v_after->'current_player'->>'rank')::integer = 126,
    (v_after->'current_player')::text);
  -- Stored counts too large to add up as bigint are capped, not fatal.
  UPDATE public.quiz_live_leaderboard_snapshots_v2
  SET computed_at = pg_catalog.clock_timestamp(), score_counts = score_counts || (
    SELECT pg_catalog.jsonb_object_agg((3000000000 + n)::text, 999999999999999999)
    FROM pg_catalog.generate_series(1, 10) AS n)
  WHERE event_id = '79000000-0000-4000-8000-000000000003';
  PERFORM pg_temp.expect('an impossible tally total is capped, not fatal',
    (pg_temp.board()->'current_player'->>'rank')::bigint > 2147483647);
END;
$$;

-- 5d. The table itself refuses a stored board the read function could not
--     unpack: entries must be a list and the tally an object.
DO $$
BEGIN
  BEGIN
    UPDATE public.quiz_live_leaderboard_snapshots_v2 SET entries = '{}'::jsonb
    WHERE event_id = '79000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'failed: entries that are not a list were stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.quiz_live_leaderboard_snapshots_v2 SET score_counts = '[]'::jsonb
    WHERE event_id = '79000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'failed: a tally that is not an object was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
