-- Keep bounded cart cleanup progressing around unresolved provider outcomes.
-- Every dispatch hold references its checkout session for audit/reconciliation,
-- including terminal holds, so no referenced session is retention-deleted here.
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
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_operations WHERE expires_at < now() LIMIT 1000
  );
  DELETE FROM public.commerce_cart_creation_requests
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_creation_requests WHERE expires_at < now() LIMIT 1000
  );
  DELETE FROM public.commerce_cart_events
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_events WHERE expires_at < now() LIMIT 1000
  );
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
