-- Restore the rollout-safe hash stamp after the deferred 20260828110000
-- migration has run. That historical migration installs an unconditional
-- insert trigger, so keep its postdeploy transaction atomic with this scoped
-- replacement and preserve legacy rows created by any trusted non-v2 caller.

CREATE OR REPLACE FUNCTION private.stamp_storefront_order_idempotency_hash_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
BEGIN
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
