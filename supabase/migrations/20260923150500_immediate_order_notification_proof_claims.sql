BEGIN;

-- Proof-bound immediate-notification claim for user-facing routes
-- (AGENTS.md: never use the admin/service-role client for user-facing
-- operations). The service-role claim/complete RPCs stay restricted,
-- so the sessionless POST /api/orders path drives delivery through
-- these narrow variants instead: each call verifies the order's
-- creation tracking token inside the SECURITY DEFINER body before
-- touching claim state, following the invoice-artifact proof-bound
-- RPC precedent. A missing or mismatched token denies uniformly
-- (claimed=false / no-op) so the proof is not an existence oracle.
-- Orders without a tracking token cannot use this path; their
-- delivery stays on the service-role worker lanes.
CREATE OR REPLACE FUNCTION public.claim_immediate_order_notification_with_proof(
  p_order_id uuid,
  p_tracking_token text
)
RETURNS TABLE (
  claimed boolean,
  claim_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL
    OR trim(p_tracking_token) = '' THEN
    RETURN QUERY SELECT false, 'unknown'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.tracking_token = p_tracking_token
  ) THEN
    RETURN QUERY SELECT false, 'unknown'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT claimed, claim_status
    FROM public.claim_immediate_order_notification(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.claim_immediate_order_notification_with_proof(uuid, text) IS
  'Proof-bound delivery claim for user-facing order creation: verifies the creation tracking token, then delegates to the service-role claim. Used by POST /api/orders on the request-scoped client (no admin).';

CREATE OR REPLACE FUNCTION public.complete_immediate_order_notification_with_proof(
  p_order_id uuid,
  p_tracking_token text,
  p_sent boolean
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

  PERFORM public.complete_immediate_order_notification(p_order_id, p_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.complete_immediate_order_notification_with_proof(uuid, text, boolean) IS
  'Proof-bound delivery completion for user-facing order creation: verifies the creation tracking token, then records sent (terminal) or failed (releasable). Used by POST /api/orders after() on the request-scoped client (no admin).';

COMMIT;
