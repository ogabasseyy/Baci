BEGIN;

-- Server-only completion proof + never-started reclaim + guest wedge flag.
--
-- 1) Forged completion (anon + tracking token could claim a stale/failed
--    row directly, then complete p_sent=true with no delivery, making
--    replays skip and success screens report notification_delivered).
--    The proof-bound completion RPC now requires an HMAC over
--    (order_id, claim_token, sent) under a server-only secret (mirrors
--    the wallet funding recovery attestation): the route computes it
--    from IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET, which is never
--    returned to tracking-token holders. The old 4-arg signature is
--    dropped so no caller completes without the proof. The secret row
--    seeds EMPTY (fail closed): a source-visible placeholder would be
--    forgeable until rotated. Until the provision cron (every 5 min)
--    stores the env secret, proof-bound completions no-op — claims stay
--    processing and replays skip, so delivery is delayed, never
--    duplicated.
--
-- 2) Never-started claims (process death between claim and after()
--    start) were indistinguishable from active delivery for the full
--    5-minute crash window, so the designed replay recovery skipped.
--    The worker now marks start as the first after() step; claims whose
--    callback never started reclaim after a 90-second grace, while
--    mid-send crashes keep the full 5-minute anti-duplicate window.
--
-- 3) Guest Paystack/Korapay payments verified by the provider but lost
--    before the webhook finalize nothing: the user-facing GET cannot
--    finalize, and the wedge sweep only selects pending Juicyway rows.
--    The GET now flags the verified-pending transaction through a
--    narrow proof-bound RPC (tracking token + reference, pending
--    payment rows only, first flag wins so re-polls do not extend the
--    sweep's webhook grace); the privileged sweep re-verifies with the
--    gateway before healing.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.immediate_notification_completion_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL
);

INSERT INTO private.immediate_notification_completion_secrets (name, secret)
VALUES ('completion_v1', '')
ON CONFLICT (name) DO NOTHING;

REVOKE ALL ON TABLE private.immediate_notification_completion_secrets
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_immediate_notification_completion_hmac_secret(
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RAISE EXCEPTION 'invalid_completion_secret' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.immediate_notification_completion_secrets (name, secret)
  VALUES ('completion_v1', p_secret)
  ON CONFLICT (name) DO UPDATE
  SET secret = EXCLUDED.secret;
END;
$$;

REVOKE ALL ON FUNCTION public.set_immediate_notification_completion_hmac_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_immediate_notification_completion_hmac_secret(text)
  TO service_role;

ALTER TABLE public.immediate_order_notification_claims
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- In-flight-at-migration rows count as started: their locked_at governs
-- reclaim exactly as before (stale ones reclaim immediately).
UPDATE public.immediate_order_notification_claims
SET started_at = locked_at
WHERE status = 'processing'
  AND started_at IS NULL;

DROP FUNCTION IF EXISTS public.claim_immediate_order_notification(uuid);
CREATE FUNCTION public.claim_immediate_order_notification(
  p_order_id uuid
)
RETURNS TABLE (
  claimed boolean,
  claim_status text,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
  v_claim_token uuid;
BEGIN
  INSERT INTO public.immediate_order_notification_claims AS c
    (order_id, merchant_id, status)
  SELECT
    p_order_id,
    o.merchant_id,
    'pending'
  FROM public.orders AS o
  WHERE o.id = p_order_id
  ON CONFLICT (order_id) DO NOTHING;

  UPDATE public.immediate_order_notification_claims AS c
  SET
    status = 'processing',
    attempt_count = c.attempt_count + 1,
    locked_at = now(),
    started_at = NULL,
    claim_token = extensions.gen_random_uuid(),
    last_error = NULL,
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND (
      c.status IN ('pending', 'failed')
      OR (
        c.status = 'processing'
        AND c.locked_at IS NOT NULL
        AND (
          -- Never-started callback (process death between claim and
          -- after()): short grace so replay recovery resumes promptly.
          (
            c.started_at IS NULL
            AND c.locked_at < now() - interval '90 seconds'
          )
          -- Started but crashed mid-send: full crash window so the
          -- replacement never overlaps a live send.
          OR c.locked_at < now() - interval '5 minutes'
        )
      )
    )
  RETURNING c.claim_token INTO v_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN QUERY SELECT true, 'processing'::text, v_claim_token;
  ELSE
    RETURN QUERY
      SELECT
        false,
        COALESCE(
          (
            SELECT c.status
            FROM public.immediate_order_notification_claims AS c
            WHERE c.order_id = p_order_id
          ),
          'unknown'
        ),
        NULL::uuid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_immediate_order_notification(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_immediate_order_notification(uuid)
  TO service_role;
-- Re-created above, so the baseline default grants to anon and
-- authenticated return with it: strip them again (see 150300) so the
-- base claim stays service-role-only.
REVOKE ALL ON FUNCTION public.claim_immediate_order_notification(uuid)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.claim_immediate_order_notification(uuid) IS
  'Atomic delivery claim for immediate order notifications: ensures a pending row for the order, then takes ownership (pending/failed/stale-processing to processing), minting a lease token the winner must present at completion and resetting started_at until the worker marks start. Never-started claims reclaim after 90s; mid-send crashes keep the 5-minute window. Used by POST /api/orders for sessionless-safe resume.';

CREATE OR REPLACE FUNCTION public.mark_immediate_order_notification_started(
  p_order_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.immediate_order_notification_claims AS c
  SET
    started_at = now(),
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND c.status = 'processing'
    AND c.claim_token = p_claim_token
    AND c.started_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_immediate_order_notification_started(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_immediate_order_notification_started(uuid, uuid)
  TO service_role;
-- Fresh function, so the baseline default grants to anon and
-- authenticated apply: strip them (see 150300) so the base marker
-- stays service-role-only.
REVOKE ALL ON FUNCTION public.mark_immediate_order_notification_started(uuid, uuid)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.mark_immediate_order_notification_started(uuid, uuid) IS
  'Marks a won delivery claim as started (after() began): idempotent first-writer flag that extends the claim to the full 5-minute crash window. Only the lease holder may mark. Used by POST /api/orders after() delivery.';

CREATE OR REPLACE FUNCTION public.mark_immediate_order_notification_started_with_proof(
  p_order_id uuid,
  p_tracking_token text,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.immediate_order_notification_claims AS c
  SET
    started_at = now(),
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND c.status = 'processing'
    AND c.claim_token = p_claim_token
    AND c.started_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_immediate_order_notification_started_with_proof(uuid, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_immediate_order_notification_started_with_proof(uuid, text, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.mark_immediate_order_notification_started_with_proof(uuid, text, uuid) IS
  'Proof-bound start marker for user-facing order creation: verifies the creation tracking token, then flags the lease as started. Used by POST /api/orders after() on the request-scoped client (no admin).';

-- Drop the unproofed completion signature: completion without the
-- server-only proof must have no callable path.
DROP FUNCTION IF EXISTS public.complete_immediate_order_notification_with_proof(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.complete_immediate_order_notification_with_proof(
  p_order_id uuid,
  p_tracking_token text,
  p_sent boolean,
  p_claim_token uuid,
  p_completion_proof text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload text;
  v_expected text;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN;
  END IF;

  -- Fail closed while unprovisioned (no oracle): the claim stays
  -- processing and replays skip until the provision cron stores the
  -- shared secret — delayed terminality, never a forged terminal.
  SELECT secret
  INTO v_secret
  FROM private.immediate_notification_completion_secrets
  WHERE name = 'completion_v1';
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RETURN;
  END IF;

  v_payload := concat_ws(
    '|',
    p_order_id::text,
    coalesce(p_claim_token::text, ''),
    CASE WHEN p_sent THEN 'sent' ELSE 'failed' END
  );
  v_expected := encode(extensions.hmac(v_payload, v_secret, 'sha256'), 'hex');
  IF lower(coalesce(p_completion_proof, '')) IS DISTINCT FROM v_expected THEN
    RETURN;
  END IF;

  PERFORM public.complete_immediate_order_notification(
    p_order_id, p_sent, p_claim_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid, text) IS
  'Proof-bound delivery completion for user-facing order creation: verifies the creation tracking token AND a server-only HMAC over (order_id, claim_token, sent) that is never returned to tracking-token holders, then records sent (terminal) or failed (releasable). Lease-fenced: the claim token holder alone may complete. Used by POST /api/orders after() on the request-scoped client (no admin).';

CREATE OR REPLACE FUNCTION public.flag_guest_payment_provider_confirmed(
  p_order_id uuid,
  p_tracking_token text,
  p_gateway_reference text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = ''
    OR p_gateway_reference IS NULL
    OR trim(p_gateway_reference) = '' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN false;
  END IF;

  -- First flag wins: repeat polls must not bump updated_at and extend
  -- the sweep's webhook grace forever.
  UPDATE public.transactions AS t
  SET
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'guest_provider_confirmed', true,
      'guest_provider_confirmed_at', now()
    ),
    updated_at = now()
  WHERE t.order_id = p_order_id
    AND t.gateway_reference = p_gateway_reference
    AND t.transaction_type = 'payment'
    AND t.status = 'pending'
    AND coalesce(t.metadata->>'guest_provider_confirmed', 'false')
      IS DISTINCT FROM 'true';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_guest_payment_provider_confirmed(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_guest_payment_provider_confirmed(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.flag_guest_payment_provider_confirmed(uuid, text, text) IS
  'Enqueues a provider-verified pending guest payment for the privileged wedge sweep: verifies the creation tracking token, then stamps the matching pending payment transaction. The sweep re-verifies with the gateway before healing. Used by the sessionless verify GET (no admin, no finalization).';

COMMIT;
