-- Preserve the authenticated legacy quiz prize path while keeping direct
-- storefront-order RPC inserts outside the trusted route boundary blocked.
-- The matching JWT claim is minted only by the server-side quiz route; the
-- trigger also binds the inserted zero-total award row to that JWT's customer.

CREATE OR REPLACE FUNCTION private.enforce_storefront_order_route_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE((SELECT auth.role()), '');
  v_jwt jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_agentic_merchant_id text;
  v_route_merchant_id text;
BEGIN
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Merchant/staff writes retain their existing independent RLS boundary.
  IF (SELECT auth.uid()) IS NOT NULL
     AND public.has_merchant_access(NEW.merchant_id) THEN
    RETURN NEW;
  END IF;

  -- Legacy quiz answers can create a zero-total prize reservation inside the
  -- guarded quiz RPC. Require both the server-minted claim and ownership of
  -- the customer row so ordinary authenticated callers cannot copy the fields.
  IF COALESCE(v_jwt ->> 'quiz_award_context', '') = 'legacy-answer'
     AND (SELECT auth.uid()) IS NOT NULL
     AND NEW.payment_method = 'quiz_award'
     AND NEW.source = 'quiz_prize'
     AND NEW.shipping_fee = 0
     AND NEW.total = 0
     AND EXISTS (
       SELECT 1
       FROM public.customers AS c
       WHERE c.id = NEW.customer_id
         AND c.merchant_id = NEW.merchant_id
         AND c.user_id = (SELECT auth.uid())
     )
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_jwt ->> 'agentic_context', '') = 'checkout' THEN
    v_agentic_merchant_id := NULLIF(
      pg_catalog.btrim(v_jwt ->> 'agentic_merchant_id'),
      ''
    );
    IF v_agentic_merchant_id IS DISTINCT FROM NEW.merchant_id::text THEN
      RAISE EXCEPTION 'storefront_order_route_context_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_route_merchant_id := NULLIF(
    pg_catalog.btrim(v_jwt ->> 'storefront_order_merchant_id'),
    ''
  );
  IF COALESCE(v_jwt ->> 'storefront_order_context', '') <> 'route'
     OR v_route_merchant_id IS DISTINCT FROM NEW.merchant_id::text THEN
    RAISE EXCEPTION 'storefront_order_route_context_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_storefront_order_route_context()
  FROM PUBLIC, anon, authenticated, service_role;
