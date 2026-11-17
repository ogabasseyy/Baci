-- Single-use, short-lived challenges that bind a live prize quiz start to a
-- freshly minted app attestation (Firebase App Check: Play Integrity on
-- Android, App Attest on iOS).
--
-- The server issues a random nonce (only its SHA-256 is stored). The app asks
-- for a challenge, then mints a NEW App Check token and sends both on the
-- start request. Consuming the challenge checks, atomically: same player, same
-- event, not expired, not used before, token not seen before, and the token
-- was minted after the challenge was issued (so a token captured earlier
-- cannot be replayed against a new challenge).
CREATE TABLE IF NOT EXISTS public.quiz_app_attestation_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.quiz_events (id) ON DELETE CASCADE,
  nonce_hash text NOT NULL,
  token_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT quiz_app_attestation_nonce_hash_format
    CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quiz_app_attestation_token_hash_format
    CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS quiz_app_attestation_nonce_hash_key
  ON public.quiz_app_attestation_challenges (nonce_hash);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_app_attestation_token_hash_key
  ON public.quiz_app_attestation_challenges (token_hash)
  WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_app_attestation_user_idx
  ON public.quiz_app_attestation_challenges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_app_attestation_event_idx
  ON public.quiz_app_attestation_challenges (event_id);

-- No policies on purpose: players never read or write the table directly;
-- only the definer functions below touch it.
ALTER TABLE public.quiz_app_attestation_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiz_app_attestation_challenges FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_quiz_app_attestation_challenge_v1(
  p_event_id uuid,
  p_nonce_hash text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_expires_at timestamptz := now() + interval '2 minutes';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  -- Only an event the caller may already see through the start guard context.
  IF coalesce(
       (public.get_quiz_start_guard_context_v2(p_event_id) ->> 'found')::boolean,
       false
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'quiz event not available' USING ERRCODE = 'P0002';
  END IF;
  -- Serialize per player so concurrent calls cannot both pass the cap check.
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended('quiz_app_attestation:' || v_user_id::text, 0)
  );
  -- Opportunistic cleanup keeps the table small without a cron job.
  DELETE FROM public.quiz_app_attestation_challenges
  WHERE user_id = v_user_id AND expires_at < now() - interval '1 day';
  -- Cap unconsumed challenges so the endpoint cannot be used to flood rows.
  IF (
    SELECT count(*) FROM public.quiz_app_attestation_challenges
    WHERE user_id = v_user_id AND consumed_at IS NULL AND expires_at > now()
  ) >= 10 THEN
    RAISE EXCEPTION 'too many open challenges' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.quiz_app_attestation_challenges
    (user_id, event_id, nonce_hash, expires_at)
  VALUES (v_user_id, p_event_id, p_nonce_hash, v_expires_at);
  RETURN v_expires_at;
END;
$$;

-- Returns true only when this call consumed a valid challenge.
CREATE OR REPLACE FUNCTION public.consume_quiz_app_attestation_challenge_v1(
  p_event_id uuid,
  p_nonce_hash text,
  p_token_hash text,
  p_token_issued_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.quiz_app_attestation_challenges AS c
  SET consumed_at = now(), token_hash = p_token_hash
  WHERE c.nonce_hash = p_nonce_hash
    AND c.user_id = v_user_id
    AND c.event_id = p_event_id
    AND c.consumed_at IS NULL
    AND c.expires_at > now()
    -- The token must be minted after the challenge (5 s clock-skew grace).
    AND p_token_issued_at >= c.created_at - interval '5 seconds'
    AND NOT EXISTS (
      SELECT 1 FROM public.quiz_app_attestation_challenges AS other
      WHERE other.token_hash = p_token_hash
    )
  RETURNING c.id INTO v_id;
  RETURN v_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_quiz_app_attestation_challenge_v1(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_quiz_app_attestation_challenge_v1(uuid, text, text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_quiz_app_attestation_challenge_v1(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_quiz_app_attestation_challenge_v1(uuid, text, text, timestamptz)
  TO authenticated;
