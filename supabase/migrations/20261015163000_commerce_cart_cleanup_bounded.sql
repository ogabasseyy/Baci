-- Bound the retention cleanup installed by
-- 20261013195818_commerce_cart_review_binding_guards: its unbatched
-- DELETE/UPDATE statements can remove an unbounded backlog in one
-- transaction after any outage, holding locks on the hot cart tables
-- and risking statement timeouts that retry the same full backlog.
-- Semantics are unchanged; each statement now touches at most 1000
-- rows per call, and the 5-minute scheduler cadence drains the rest
-- across passes (the same bounded pattern as the terminal purge).
CREATE OR REPLACE FUNCTION public.cleanup_commerce_carts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Account operations arrive in a later migration; purge them once present.
  IF to_regclass('public.commerce_cart_account_operations') IS NOT NULL THEN
    DELETE FROM public.commerce_cart_account_operations
    WHERE ctid IN (
      SELECT ctid FROM public.commerce_cart_account_operations
      WHERE expires_at < now() LIMIT 1000
    );
  END IF;
  DELETE FROM public.commerce_cart_operations
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_operations
    WHERE expires_at < now() LIMIT 1000
  );
  DELETE FROM public.commerce_cart_creation_requests
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_creation_requests
    WHERE expires_at < now() LIMIT 1000
  );
  DELETE FROM public.commerce_cart_events
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_events
    WHERE expires_at < now() LIMIT 1000
  );
  DELETE FROM public.commerce_cart_handoffs
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_handoffs
    WHERE expires_at < now() - interval '1 day' LIMIT 1000
  );
  DELETE FROM public.commerce_cart_checkout_sessions
  WHERE ctid IN (
    SELECT ctid FROM public.commerce_cart_checkout_sessions
    WHERE (status = 'submitted' AND submitted_at < now() - interval '90 days')
      OR (status <> 'submitted' AND expires_at < now() - interval '1 day')
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
    LIMIT 1000
  );
END;
$$;
