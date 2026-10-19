-- Persist route-owned delivery metadata before the new application revision
-- is promoted. The deferred migration replaces this compatibility bridge with
-- full fee and quote validation after the new route is serving traffic.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS airport_type text;

CREATE OR REPLACE FUNCTION private.validate_storefront_order_delivery_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_route_context boolean :=
    COALESCE(v_jwt ->> 'storefront_order_context', '') = 'route'
    AND pg_catalog.btrim(
      COALESCE(v_jwt ->> 'storefront_order_merchant_id', '')
    ) = NEW.merchant_id::text;
  v_delivery_method text;
  v_airport_type text;
BEGIN
  -- The old revision does not send these keys. Only a signed, merchant-bound
  -- route may consume them during the compatibility window.
  IF NOT v_route_context
     OR pg_catalog.jsonb_typeof(NEW.ad_tracking) <> 'object'
  THEN
    RETURN NEW;
  END IF;

  v_delivery_method := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(NEW.ad_tracking ->> '__baci_delivery_method')
    ),
    ''
  );
  v_airport_type := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(NEW.ad_tracking ->> '__baci_airport_type')
    ),
    ''
  );

  NEW.delivery_method := COALESCE(NEW.delivery_method, v_delivery_method);
  NEW.airport_type := COALESCE(NEW.airport_type, v_airport_type);
  NEW.ad_tracking := NEW.ad_tracking
    - '__baci_delivery_method'
    - '__baci_airport_type';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_storefront_order_delivery_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

-- The serialized-order persistence migration runs before the concrete airport
-- pickup validator. Keep its update trigger installable without enabling that
-- enforcement against the old application revision; the postdeploy migration
-- replaces this function in place before the validator can reject new orders.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'private.validate_storefront_airport_pickup_location()'
  ) IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION private.validate_storefront_airport_pickup_location()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $body$
      BEGIN
        RETURN NEW;
      END;
      $body$;
    $function$;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_storefront_airport_pickup_location()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS validate_storefront_order_delivery_metadata ON public.orders;

CREATE TRIGGER validate_storefront_order_delivery_metadata
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_storefront_order_delivery_metadata();

COMMENT ON FUNCTION private.validate_storefront_order_delivery_metadata() IS
  'Persists signed storefront delivery metadata before deferred fee and quote validation is installed.';
