-- Fast provisional standings. Final rankings remain materialized separately.
CREATE TABLE IF NOT EXISTS public.quiz_live_standings_v2 (
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  score integer NOT NULL,
  total_time_milliseconds bigint NOT NULL,
  submitted_at timestamptz NOT NULL,
  leaderboard_username text,
  attempt_status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, customer_id),
  UNIQUE (event_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS quiz_live_standings_v2_order_idx
  ON public.quiz_live_standings_v2
    (event_id, score DESC, total_time_milliseconds ASC, submitted_at ASC, attempt_id ASC);
CREATE INDEX IF NOT EXISTS quiz_live_standings_v2_attempt_idx ON public.quiz_live_standings_v2 (attempt_id);
CREATE INDEX IF NOT EXISTS quiz_live_standings_v2_customer_idx ON public.quiz_live_standings_v2 (customer_id);

ALTER TABLE public.quiz_live_standings_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_live_standings_v2 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.refresh_quiz_live_standing_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_elapsed bigint;
BEGIN
  IF NEW.status NOT IN ('submitted', 'scored') OR NEW.submitted_at IS NULL THEN
    RETURN NEW;
  END IF;
  v_elapsed := pg_catalog.floor(EXTRACT(EPOCH FROM (NEW.submitted_at - NEW.started_at)) * 1000)::bigint;
  INSERT INTO public.quiz_live_standings_v2 (
    event_id, customer_id, attempt_id, score, total_time_milliseconds,
    submitted_at, leaderboard_username, attempt_status, updated_at
  )
  VALUES (
    NEW.event_id, NEW.customer_id, NEW.id, COALESCE(NEW.score, 0), v_elapsed,
    NEW.submitted_at, NEW.leaderboard_username, NEW.status, now()
  )
  ON CONFLICT (event_id, customer_id) DO UPDATE
  SET attempt_id = EXCLUDED.attempt_id,
      score = EXCLUDED.score,
      total_time_milliseconds = EXCLUDED.total_time_milliseconds,
      submitted_at = EXCLUDED.submitted_at,
      leaderboard_username = EXCLUDED.leaderboard_username,
      attempt_status = EXCLUDED.attempt_status,
      updated_at = now()
  WHERE (EXCLUDED.score, -EXCLUDED.total_time_milliseconds, -EXTRACT(EPOCH FROM EXCLUDED.submitted_at), EXCLUDED.attempt_id::text)
      > (quiz_live_standings_v2.score, -quiz_live_standings_v2.total_time_milliseconds, -EXTRACT(EPOCH FROM quiz_live_standings_v2.submitted_at), quiz_live_standings_v2.attempt_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quiz_live_standing_v2 ON public.quiz_attempts;
CREATE TRIGGER trg_quiz_live_standing_v2
AFTER INSERT OR UPDATE OF status, score, submitted_at ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION private.refresh_quiz_live_standing_v2();

CREATE OR REPLACE FUNCTION public.get_quiz_live_leaderboard_public_v2(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_customer_id uuid;
  v_entries jsonb;
  v_current jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT event.* INTO v_event FROM public.quiz_events event WHERE event.id = p_event_id;
  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  IF v_event.mode = 'test' AND NOT (
    public.has_merchant_access(v_event.merchant_id) OR EXISTS (
      SELECT 1 FROM public.quiz_event_testers AS tester
      WHERE tester.event_id = v_event.id AND tester.user_id = auth.uid() AND tester.revoked_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  IF v_event.mode = 'live' AND NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  SELECT customer.id INTO v_customer_id FROM public.customers customer
    WHERE customer.merchant_id = v_event.merchant_id AND customer.user_id = auth.uid() AND customer.deleted_at IS NULL LIMIT 1;
  IF v_event.id IS NULL OR v_customer_id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  WITH ranked AS (
    SELECT row_number() OVER (ORDER BY live.score DESC, live.total_time_milliseconds, live.submitted_at, live.attempt_id) AS rank,
      live.*, customer.deleted_at, suppression.id AS suppressed
    FROM public.quiz_live_standings_v2 live
    LEFT JOIN public.customers customer ON customer.id = live.customer_id
    LEFT JOIN public.quiz_leaderboard_identity_suppressions suppression ON suppression.attempt_id = live.attempt_id
    WHERE live.event_id = p_event_id
  ), projected AS (
    SELECT rank, customer_id, jsonb_build_object(
      'customer_name', CASE WHEN deleted_at IS NOT NULL OR suppressed IS NOT NULL OR NULLIF(btrim(leaderboard_username), '') IS NULL
        THEN private.quiz_public_leaderboard_alias(p_event_id, customer_id) ELSE btrim(leaderboard_username) END,
      'is_current_customer', customer_id = v_customer_id, 'rank', rank, 'score', score,
      'status', attempt_status, 'submitted_at', submitted_at,
      'total_time_seconds', total_time_milliseconds::double precision / 1000.0::double precision
    ) AS entry FROM ranked
  )
  SELECT COALESCE(jsonb_agg(entry ORDER BY rank) FILTER (WHERE rank <= 100), '[]'::jsonb),
    (jsonb_agg(entry ORDER BY rank) FILTER (WHERE customer_id = v_customer_id))->0
  INTO v_entries, v_current FROM projected;
  RETURN jsonb_build_object('status', 'live', 'entries', v_entries, 'current_player', v_current);
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_live_leaderboard_public_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_live_leaderboard_public_v2(uuid) TO authenticated;

INSERT INTO public.quiz_live_standings_v2 (event_id, customer_id, attempt_id, score, total_time_milliseconds, submitted_at, leaderboard_username, attempt_status)
SELECT event_id, customer_id, id, score, total_time_milliseconds, submitted_at, leaderboard_username, status
FROM (
  SELECT a.event_id, a.customer_id, a.id, COALESCE(a.score, 0) AS score,
    floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) * 1000)::bigint AS total_time_milliseconds,
    a.submitted_at, a.leaderboard_username, a.status,
    row_number() OVER (PARTITION BY a.event_id, a.customer_id ORDER BY a.score DESC NULLS LAST,
      floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) * 1000), a.submitted_at, a.id) AS attempt_rank
  FROM public.quiz_attempts a
  WHERE a.status IN ('submitted', 'scored') AND a.submitted_at IS NOT NULL
) AS best
WHERE attempt_rank = 1
ON CONFLICT (event_id, customer_id) DO NOTHING;
