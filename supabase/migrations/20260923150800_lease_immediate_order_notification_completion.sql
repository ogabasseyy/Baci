BEGIN;

-- Lease-fenced immediate-notification completion + merchant index.
--
-- When a processing claim outlives the five-minute reclaim window, a
-- replay reclaims it while the original after() worker may still be
-- running. Completion keyed only on (order_id, processing) lets the
-- stale worker complete the replacement worker's claim: finishing with
-- p_sent=false while the replacement is sending downgrades the row,
-- makes the replacement's completion no-op, and resends the customer a
-- duplicate document on the next replay.
--
-- The claim RPC now mints a lease token (extensions.gen_random_uuid)
-- on every win — including stale-lock reclaims — returns it as a third
-- column (the proof-bound claim passes it through), and both the base
-- and proof-bound complete RPCs require
-- AND claim_token = p_claim_token. The old complete signatures are
-- dropped so no caller can complete without the lease.
--
-- The claims table grows one row per immediate order notification and
-- PostgreSQL does not auto-index referencing columns, so merchant
-- deletes would scan the table to enforce ON DELETE CASCADE: index
-- merchant_id.
ALTER TABLE public.immediate_order_notification_claims
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE INDEX IF NOT EXISTS immediate_order_notification_claims_merchant_id_idx
  ON public.immediate_order_notification_claims (merchant_id);

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
    claim_token = extensions.gen_random_uuid(),
    last_error = NULL,
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND (
      c.status IN ('pending', 'failed')
      OR (
        c.status = 'processing'
        AND c.locked_at IS NOT NULL
        AND c.locked_at < now() - interval '5 minutes'
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
  'Atomic delivery claim for immediate order notifications: ensures a pending row for the order, then takes ownership (pending/failed/stale-processing to processing), minting a lease token the winner must present at completion. Only the claimed caller may run after() delivery; replays reclaim failed or crashed claims. Used by POST /api/orders for sessionless-safe resume.';

DROP FUNCTION IF EXISTS public.complete_immediate_order_notification(uuid, boolean);
CREATE OR REPLACE FUNCTION public.complete_immediate_order_notification(
  p_order_id uuid,
  p_sent boolean,
  p_claim_token uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.immediate_order_notification_claims AS c
  SET
    status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_sent THEN now() ELSE c.sent_at END,
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND c.status = 'processing'
    AND c.claim_token = p_claim_token;
$$;

REVOKE ALL ON FUNCTION public.complete_immediate_order_notification(uuid, boolean, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_immediate_order_notification(uuid, boolean, uuid)
  TO service_role;
-- The baseline grants EXECUTE on every postgres-created function to anon
-- and authenticated via default privileges (see the 150300 revoke): strip
-- the role-specific default grants on the new signature as well so the
-- base complete RPCs stay service-role-only.
REVOKE ALL ON FUNCTION public.complete_immediate_order_notification(
  uuid, boolean, uuid
)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.complete_immediate_order_notification(uuid, boolean, uuid) IS
  'Records immediate order notification delivery: sent (terminal, replays skip) or failed (releasable, the next replay resumes). Lease-fenced: only the claim token holder may complete. Used by POST /api/orders after() delivery.';

DROP FUNCTION IF EXISTS public.claim_immediate_order_notification_with_proof(uuid, text);
CREATE FUNCTION public.claim_immediate_order_notification_with_proof(
  p_order_id uuid,
  p_tracking_token text
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
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN QUERY SELECT false, 'unknown'::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN QUERY SELECT false, 'unknown'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      inner_claim.claimed,
      inner_claim.claim_status,
      inner_claim.claim_token
    FROM public.claim_immediate_order_notification(p_order_id)
      AS inner_claim;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text) IS
  'Proof-bound delivery claim for user-facing order creation: verifies the creation tracking token, then delegates to the service-role claim, returning the lease token the winner must present at completion. Used by POST /api/orders on the request-scoped client (no admin).';

DROP FUNCTION IF EXISTS public.complete_immediate_order_notification_with_proof(uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.complete_immediate_order_notification_with_proof(
  p_order_id uuid,
  p_tracking_token text,
  p_sent boolean,
  p_claim_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  PERFORM public.complete_immediate_order_notification(
    p_order_id, p_sent, p_claim_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid) IS
  'Proof-bound delivery completion for user-facing order creation: verifies the creation tracking token, then records sent (terminal) or failed (releasable). Lease-fenced: the claim token holder alone may complete. Used by POST /api/orders after() on the request-scoped client (no admin).';

COMMIT;
