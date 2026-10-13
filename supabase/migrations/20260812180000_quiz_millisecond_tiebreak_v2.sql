-- Make the speed tie-break explicit and reproducible. Device/network timing is
-- not accurate enough to claim nanosecond precision, so equal milliseconds use
-- the existing server timestamp and attempt-id fallback.

ALTER TABLE public.quiz_event_results_v2
  ADD COLUMN IF NOT EXISTS total_time_milliseconds bigint;

UPDATE public.quiz_event_results_v2
SET total_time_milliseconds = pg_catalog.floor(total_time_seconds * 1000)::bigint
WHERE total_time_milliseconds IS NULL;

ALTER TABLE public.quiz_event_results_v2
  ALTER COLUMN total_time_milliseconds SET NOT NULL;

CREATE OR REPLACE FUNCTION private.quiz_ranked_candidates_v2(p_event_id uuid)
RETURNS TABLE(
  rank bigint,
  attempt_id uuid,
  customer_id uuid,
  score integer,
  total_time_seconds double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH best AS (
    SELECT DISTINCT ON (a.customer_id)
      a.id,
      a.customer_id,
      a.score,
      a.started_at,
      a.submitted_at,
      pg_catalog.floor(
        EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) * 1000
      )::bigint AS elapsed_milliseconds
    FROM public.quiz_attempts AS a
    WHERE a.event_id = p_event_id
      AND a.status IN ('submitted', 'scored')
      AND a.submitted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.quiz_attempt_signal_flags AS flag
        WHERE flag.attempt_id = a.id AND flag.severity = 'block'
      )
    ORDER BY a.customer_id, a.score DESC,
      pg_catalog.floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) * 1000),
      a.submitted_at, a.id
  )
  SELECT pg_catalog.row_number() OVER (
      ORDER BY best.score DESC, best.elapsed_milliseconds,
        best.submitted_at, best.id
    ),
    best.id,
    best.customer_id,
    best.score,
    best.elapsed_milliseconds::double precision / 1000.0::double precision
  FROM best;
$$;

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
    attempt.submitted_at, attempt.leaderboard_username, attempt.status
  FROM private.quiz_ranked_candidates_v2(p_event_id) AS ranked
  JOIN public.quiz_attempts AS attempt ON attempt.id = ranked.attempt_id
  ORDER BY ranked.rank;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DO $$
DECLARE
  v_event record;
BEGIN
  FOR v_event IN
    SELECT event.id FROM public.quiz_events AS event
    WHERE event.contract_version = 2 AND event.results_published_at IS NOT NULL
  LOOP
    PERFORM private.materialize_quiz_event_results_v2(v_event.id);
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.quiz_event_results_v2.total_time_milliseconds IS
  'Server-derived elapsed time used for the skill tie-break; equal values fall through to submitted_at and attempt_id.';
