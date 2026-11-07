-- Allow the isolated capture worker to renew a live claim, and allow a
-- successful inline receiver to close a row already claimed by the drain.
-- CREATE OR REPLACE retains both functions' existing ACLs.

CREATE OR REPLACE FUNCTION public.resolve_claimed_piggyvest_webhook_capture(
  p_id uuid,
  p_claim_token uuid,
  p_state text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_lease_until timestamptz;
BEGIN
  IF p_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'a claimed capture and its claim token are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_state = 'renew' THEN
    IF p_error IS NOT NULL THEN
      RAISE EXCEPTION 'renew does not accept an error' USING ERRCODE = '22023';
    END IF;

    SELECT c.lease_until INTO v_lease_until
    FROM public.piggyvest_webhook_captures c
    WHERE c.id = p_id
      AND c.processing_state = 'claimed'
      AND c.claim_token = p_claim_token
    FOR UPDATE;

    IF NOT FOUND OR v_lease_until <= clock_timestamp() THEN
      RETURN false;
    END IF;

    UPDATE public.piggyvest_webhook_captures c
    SET lease_until = clock_timestamp() + interval '300 seconds',
        updated_at = clock_timestamp()
    WHERE c.id = p_id
      AND c.processing_state = 'claimed'
      AND c.claim_token = p_claim_token
      AND c.lease_until > clock_timestamp();
    RETURN FOUND;
  END IF;

  RETURN public.resolve_piggyvest_webhook_capture(p_id, p_claim_token, p_state, p_error);
END
$$;

CREATE OR REPLACE FUNCTION public.resolve_piggyvest_webhook_capture(
  p_id uuid,
  p_claim_token uuid,
  p_state text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('pending', 'processed', 'needs_review', 'deferred') THEN
    RAISE EXCEPTION 'invalid webhook capture state' USING ERRCODE = '22023';
  END IF;
  IF p_claim_token IS NULL AND p_state IN ('needs_review', 'deferred') THEN
    RAISE EXCEPTION 'review and deferral states require a claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.piggyvest_webhook_captures c
  SET processing_state = CASE WHEN p_state = 'deferred' THEN 'pending' ELSE p_state END,
      last_error = left(p_error, 200),
      attempts = CASE
        WHEN p_state = 'deferred' THEN greatest(c.attempts - 1, 0)
        ELSE c.attempts
      END,
      config_deferrals = CASE
        WHEN p_state = 'deferred' THEN least(c.config_deferrals + 1, 1000)
        ELSE c.config_deferrals
      END,
      next_attempt_at = CASE
        WHEN p_state = 'deferred' THEN clock_timestamp() + make_interval(
          secs => least(3600::double precision, 60 * power(2, least(c.config_deferrals, 10)))
        )
        WHEN p_state = 'pending' AND p_claim_token IS NOT NULL THEN clock_timestamp() + make_interval(
          secs => least(3600::double precision, 30 * power(2, least(c.attempts, 10)))
        )
        ELSE c.next_attempt_at
      END,
      processed_at = CASE WHEN p_state = 'processed' THEN clock_timestamp() ELSE c.processed_at END,
      claim_token = NULL,
      lease_until = NULL,
      updated_at = clock_timestamp()
  WHERE c.id = p_id
    AND (
      (p_claim_token IS NOT NULL AND c.processing_state = 'claimed' AND c.claim_token = p_claim_token)
      OR (p_claim_token IS NULL AND (
        c.processing_state = 'pending'
        OR (p_state = 'processed' AND c.processing_state IN ('needs_review', 'claimed'))
      ))
    );
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.piggyvest_webhook_capture_status()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE processing_state = 'pending'),
    'claimed', count(*) FILTER (WHERE processing_state = 'claimed'),
    'needsReview', count(*) FILTER (WHERE processing_state = 'needs_review'),
    'oldestUnprocessedAt', min(received_at) FILTER (WHERE processing_state IN ('pending', 'claimed')),
    'lastCapturedAt', max(received_at),
    'lastProcessedAt', max(processed_at),
    'claimRecoveryVersion', 1
  )
  FROM public.piggyvest_webhook_captures
$$;
