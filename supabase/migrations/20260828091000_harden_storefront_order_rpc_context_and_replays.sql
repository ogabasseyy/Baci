-- Close the public storefront-order trust boundary and preserve retries for
-- orders created before delivery metadata became part of the idempotency hash.
-- The public RPC remains callable by anon/authenticated for PostgREST
-- compatibility, but inserts must now carry a short-lived, server-signed JWT
-- context (or the existing scoped agentic context). Direct client RPC calls
-- cannot manufacture that context.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_request_hash_version smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_checkout_request_hash_version_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_checkout_request_hash_version_check
      CHECK (
        checkout_request_hash_version IS NULL
        OR checkout_request_hash_version >= 2
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.orders.checkout_request_hash_version IS
  'Canonical checkout idempotency hash version; NULL marks an order created before delivery metadata was included.';

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
  -- Internal workers and the existing agentic scoped client are trusted
  -- server contexts. All other inserts, including direct anon/authenticated
  -- calls to public.create_storefront_order, require the route-bound claim.
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Merchant/staff writes (for example, mobile-admin manual orders) already
  -- have an independent RLS permission boundary. Keep those first-party
  -- writes working without allowing anonymous/customer RPC callers to reuse
  -- that path as a delivery-metadata trust signal.
  IF (SELECT auth.uid()) IS NOT NULL
     AND public.has_merchant_access(NEW.merchant_id) THEN
    RETURN NEW;
  END IF;

  -- Legacy quiz answers can create a zero-total prize reservation inside the
  -- guarded quiz RPC. Install this exception with the trigger itself so the
  -- postdeploy migration cannot expose a partial enforcement window.
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

DROP TRIGGER IF EXISTS enforce_storefront_order_route_context ON public.orders;

CREATE TRIGGER enforce_storefront_order_route_context
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_storefront_order_route_context();

CREATE OR REPLACE FUNCTION private.stamp_storefront_order_idempotency_hash_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.checkout_request_hash_version := 2;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_storefront_order_idempotency_hash_version()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS stamp_storefront_order_idempotency_hash_version ON public.orders;

CREATE TRIGGER stamp_storefront_order_idempotency_hash_version
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.stamp_storefront_order_idempotency_hash_version();

CREATE OR REPLACE FUNCTION public.is_legacy_storefront_order_idempotency_key(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE p_merchant_id IS NOT NULL
      AND p_checkout_idempotency_key IS NOT NULL
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
      AND o.checkout_request_hash_version IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_legacy_storefront_order_idempotency_key(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_legacy_storefront_order_idempotency_key(uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.is_legacy_storefront_order_idempotency_key(uuid, text) IS
  'Returns only whether a merchant-scoped checkout key belongs to an order created before hash version 2; no order fields are exposed.';
