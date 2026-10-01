-- Reapply the millisecond ranking definition with stable aliases after the
-- append-only migration was initially applied.

CREATE OR REPLACE FUNCTION private.quiz_ranked_candidates_v2(p_event_id uuid)
RETURNS TABLE(rank bigint, attempt_id uuid, customer_id uuid, score integer, total_time_seconds double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH best AS (
    SELECT DISTINCT ON (a.customer_id)
      a.id, a.customer_id, a.score, a.started_at, a.submitted_at,
      pg_catalog.floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) * 1000)::bigint AS elapsed_milliseconds
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
      ORDER BY best.score DESC, best.elapsed_milliseconds, best.submitted_at, best.id
    ), best.id, best.customer_id, best.score,
    best.elapsed_milliseconds::double precision / 1000.0::double precision
  FROM best;
$$;

DO $$
DECLARE v_event record;
BEGIN
  FOR v_event IN SELECT id FROM public.quiz_events WHERE contract_version = 2 AND results_published_at IS NOT NULL
  LOOP
    PERFORM private.materialize_quiz_event_results_v2(v_event.id);
  END LOOP;
END;
$$;
