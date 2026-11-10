-- Live holds protect every checkout generation for their cart. Terminal holds
-- also retain their referenced carts and sessions for audit. The rollout
-- singleton is internal state and must carry the same RLS boundary as holds.
ALTER TABLE private.agentic_cart_dispatch_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.agentic_cart_dispatch_rollout FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_commerce_carts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF to_regclass('public.commerce_cart_account_operations') IS NOT NULL THEN
    DELETE FROM public.commerce_cart_account_operations
    WHERE ctid IN (
      SELECT ctid FROM public.commerce_cart_account_operations
      WHERE expires_at < now() LIMIT 1000
    );
  END IF;
  DELETE FROM public.commerce_cart_operations
  WHERE ctid IN (SELECT ctid FROM public.commerce_cart_operations WHERE expires_at < now() LIMIT 1000);
  DELETE FROM public.commerce_cart_creation_requests
  WHERE ctid IN (SELECT ctid FROM public.commerce_cart_creation_requests WHERE expires_at < now() LIMIT 1000);
  DELETE FROM public.commerce_cart_events
  WHERE ctid IN (SELECT ctid FROM public.commerce_cart_events WHERE expires_at < now() LIMIT 1000);
  DELETE FROM public.commerce_cart_handoffs h
  WHERE h.ctid IN (
    SELECT h2.ctid FROM public.commerce_cart_handoffs h2
    WHERE h2.expires_at < now() - interval '1 day'
      AND NOT private.agentic_cart_dispatch_hold_is_live(h2.merchant_id, h2.source_cart_id)
    LIMIT 1000
  );
  DELETE FROM public.commerce_cart_checkout_sessions s
  WHERE s.ctid IN (
    SELECT s2.ctid FROM public.commerce_cart_checkout_sessions s2
    WHERE ((s2.status = 'submitted' AND s2.submitted_at < now() - interval '90 days')
        OR (s2.status <> 'submitted' AND s2.expires_at < now() - interval '1 day'))
      AND NOT private.agentic_cart_dispatch_hold_is_live(s2.merchant_id, s2.cart_id)
      AND NOT EXISTS (
        SELECT 1 FROM private.agentic_cart_dispatch_holds h
        WHERE h.checkout_session_id = s2.id
      )
    LIMIT 1000
  );
  UPDATE public.commerce_carts c
  SET state = 'expired', updated_at = now()
  WHERE c.ctid IN (
    SELECT c2.ctid FROM public.commerce_carts c2
    WHERE c2.state = 'active' AND c2.expires_at < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.commerce_cart_checkout_sessions s
        WHERE s.merchant_id = c2.merchant_id AND s.cart_id = c2.id
          AND s.status = 'active' AND s.expires_at > now()
      )
      AND NOT private.agentic_cart_dispatch_hold_is_live(c2.merchant_id, c2.id)
    LIMIT 1000
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_purge_terminal_carts(
  p_max_age interval DEFAULT interval '90 days',
  p_batch integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE deleted_count integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age < interval '30 days' THEN
    RAISE EXCEPTION 'cart retention window must be at least 30 days';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'cart purge batch must be between 1 and 10000';
  END IF;
  WITH doomed AS (
    SELECT c.id
    FROM public.commerce_carts c
    WHERE c.state IN ('completed', 'expired', 'canceled')
      AND c.updated_at < pg_catalog.now() - p_max_age
      AND NOT EXISTS (
        SELECT 1 FROM private.agentic_cart_dispatch_holds h
        WHERE h.merchant_id = c.merchant_id AND h.cart_id = c.id
      )
    ORDER BY c.updated_at
    LIMIT p_batch
  )
  DELETE FROM public.commerce_carts c
  USING doomed d
  WHERE c.id = d.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  DELETE FROM public.commerce_cart_device_retirements r
  WHERE r.retired_at < now() - interval '30 days'
    AND (r.merchant_id, r.device_principal_id) IN (
      SELECT t.merchant_id, t.device_principal_id
      FROM public.commerce_cart_device_retirements t
      WHERE t.retired_at < now() - interval '30 days'
      ORDER BY t.retired_at
      LIMIT p_batch
    );
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  FROM PUBLIC, anon, authenticated, commerce_cart_shopper;
GRANT EXECUTE ON FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  TO service_role;
