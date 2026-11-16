-- Serve the live quiz leaderboard from a shared snapshot.
--
-- get_quiz_live_leaderboard_public_v2 re-ranked every finished player, joined
-- every one of them to customers and built their JSON on every call, and each
-- phone on the results screen calls it every few seconds. With N players that
-- is N callers each doing work proportional to N. The participant count did a
-- second full count per call.
--
-- Now the top 100, the participant count and a per-score histogram are
-- computed once per event at most every 2 seconds and stored in one row.
-- Whichever request finds the row stale refreshes it (single flight through a
-- transaction advisory lock); everyone else reads the stored row. A caller's
-- own rank comes from the histogram (players with a higher score) plus a
-- bounded index range scan inside the caller's own score bucket.
--
-- The JSON shape is unchanged except for one added key, participant_count, so
-- the API route can stop making a second database call. Privacy rules for
-- names (deleted customer, suppressed identity, blank username) are the same.
--
-- Part 1 of 3: the snapshot table and the function that rebuilds it. Nothing
-- reads it until parts 2 and 3 (20261116203101, 20261116203102) replace the
-- two read functions, so this part is safe on its own.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quiz_live_leaderboard_snapshots_v2 (
  event_id uuid PRIMARY KEY REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  -- Top 100 in rank order. Each entry carries customer_id for the per-caller
  -- is_current_customer flag; the read function strips it before returning.
  -- The checks pin the top-level shape only (a list, an object), so the read
  -- function's unpacking calls cannot fail on it. They do not validate each
  -- entry: only the refresher writes this table, and the read function
  -- guards its own casts on the tally.
  entries jsonb NOT NULL
    CHECK (pg_catalog.jsonb_typeof(entries) = 'array'),
  -- {"<score>": <players with that score>}
  score_counts jsonb NOT NULL
    CHECK (pg_catalog.jsonb_typeof(score_counts) = 'object'),
  participant_count integer NOT NULL CHECK (participant_count >= 0),
  computed_at timestamptz NOT NULL,
  -- Players ranked when results were published. Stored once by the count
  -- function (20261116203102) on its first read after publication; NULL
  -- until then. The rebuild below never touches it.
  published_participant_count integer
    CHECK (published_participant_count >= 0)
);
-- The caveat lives on the column, where someone repairing data will see it.
COMMENT ON COLUMN
  public.quiz_live_leaderboard_snapshots_v2.published_participant_count IS
  'Players ranked at publication, stored on the first count read after publication. Set to NULL after re-ranking an already published event so the next read recounts.';

ALTER TABLE public.quiz_live_leaderboard_snapshots_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_live_leaderboard_snapshots_v2
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS quiz_live_leaderboard_snapshots_v2_no_direct_client_access
  ON public.quiz_live_leaderboard_snapshots_v2;
CREATE POLICY quiz_live_leaderboard_snapshots_v2_no_direct_client_access
  ON public.quiz_live_leaderboard_snapshots_v2
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.refresh_quiz_live_leaderboard_snapshot_v2(
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entries jsonb;
  v_participants integer;
  v_score_counts jsonb;
BEGIN
  -- One statement, so the top 100, the histogram and the count all describe
  -- the same committed standings.
  WITH top AS (
    SELECT live.*
    FROM public.quiz_live_standings_v2 AS live
    WHERE live.event_id = p_event_id
    ORDER BY live.score DESC, live.total_time_milliseconds,
      live.submitted_at, live.attempt_id
    LIMIT 100
  ), ranked AS (
    SELECT
      pg_catalog.row_number() OVER (
        ORDER BY top.score DESC, top.total_time_milliseconds,
          top.submitted_at, top.attempt_id
      ) AS rank,
      top.*,
      customer.deleted_at,
      suppression.id AS suppressed
    FROM top
    LEFT JOIN public.customers AS customer ON customer.id = top.customer_id
    LEFT JOIN public.quiz_leaderboard_identity_suppressions AS suppression
      ON suppression.attempt_id = top.attempt_id
  ), board AS (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'customer_id', ranked.customer_id,
          'customer_name', CASE
            WHEN ranked.deleted_at IS NOT NULL
              OR ranked.suppressed IS NOT NULL
              OR NULLIF(pg_catalog.btrim(ranked.leaderboard_username), '') IS NULL
            THEN private.quiz_public_leaderboard_alias(p_event_id, ranked.customer_id)
            ELSE pg_catalog.btrim(ranked.leaderboard_username)
          END,
          'rank', ranked.rank,
          'score', ranked.score,
          'status', ranked.attempt_status,
          'submitted_at', ranked.submitted_at,
          'total_time_seconds',
            ranked.total_time_milliseconds::double precision / 1000.0::double precision
        )
        ORDER BY ranked.rank
      ),
      '[]'::jsonb
    ) AS entries
    FROM ranked
  ), bucket AS (
    SELECT live.score, pg_catalog.count(*) AS players
    FROM public.quiz_live_standings_v2 AS live
    WHERE live.event_id = p_event_id
    GROUP BY live.score
  ), histogram AS (
    SELECT
      COALESCE(
        pg_catalog.jsonb_object_agg(bucket.score::text, bucket.players),
        '{}'::jsonb
      ) AS score_counts,
      COALESCE(pg_catalog.sum(bucket.players), 0)::integer AS participants
    FROM bucket
  )
  SELECT board.entries, histogram.score_counts, histogram.participants
  INTO v_entries, v_score_counts, v_participants
  FROM board CROSS JOIN histogram;

  INSERT INTO public.quiz_live_leaderboard_snapshots_v2 (
    event_id, entries, score_counts, participant_count, computed_at
  ) VALUES (
    p_event_id, v_entries, v_score_counts, v_participants,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (event_id) DO UPDATE
  SET entries = EXCLUDED.entries,
      score_counts = EXCLUDED.score_counts,
      participant_count = EXCLUDED.participant_count,
      computed_at = EXCLUDED.computed_at;
END;
$$;

ALTER FUNCTION private.refresh_quiz_live_leaderboard_snapshot_v2(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.refresh_quiz_live_leaderboard_snapshot_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
