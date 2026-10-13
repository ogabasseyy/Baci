-- Install the hash-version column, legacy probe, and rollout-safe stamp before
-- the new route is promoted. The old route still serves during predeploy, so
-- only a signed v2 storefront context may mark a keyed order as version 2.

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
  'Canonical checkout idempotency hash version; NULL marks an order created before hash version 2.';

CREATE OR REPLACE FUNCTION private.stamp_storefront_order_idempotency_hash_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
BEGIN
  -- Do not let the predeploy trigger relabel hashes from the old route. The
  -- route-bound v2 claim is signed by the server and merchant-bound as an
  -- independent check from the route-context authorization trigger.
  NEW.checkout_request_hash_version := NULL;

  IF NEW.checkout_request_hash IS NOT NULL
     AND COALESCE(v_jwt ->> 'storefront_order_context', '') = 'route'
     AND COALESCE(v_jwt ->> 'storefront_order_hash_version', '') = '2'
     AND pg_catalog.btrim(
       COALESCE(v_jwt ->> 'storefront_order_merchant_id', '')
     ) = NEW.merchant_id::text
  THEN
    NEW.checkout_request_hash_version := 2;
  END IF;

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
