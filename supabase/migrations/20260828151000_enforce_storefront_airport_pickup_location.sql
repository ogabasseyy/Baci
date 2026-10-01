-- Keep fixed airport-pickup orders fulfillable at the database boundary. This
-- trigger is deferred until the application revision that sends the durable
-- delivery metadata is live; its name sorts before the metadata trigger so it
-- can also validate the reserved route context on the first insert.

CREATE OR REPLACE FUNCTION private.validate_storefront_airport_pickup_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_method text;
  v_airport_type text;
  v_address_marker text;
  v_city text;
  v_state text;
BEGIN
  v_address_marker := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(NEW.shipping_address ->> 'address', ''))
  );
  v_delivery_method := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(
        COALESCE(
          NEW.delivery_method,
          NEW.ad_tracking ->> '__baci_delivery_method',
          CASE
            WHEN v_address_marker = 'airport pickup' THEN 'airport'
            ELSE ''
          END,
          ''
        )
      )
    ),
    ''
  );
  v_airport_type := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(
        COALESCE(
          NEW.airport_type,
          NEW.ad_tracking ->> '__baci_airport_type',
          CASE
            WHEN v_address_marker = 'airport pickup' THEN 'pickup'
            ELSE ''
          END,
          ''
        )
      )
    ),
    ''
  );

  IF v_delivery_method = 'airport' AND v_airport_type = 'pickup'
    AND NEW.selected_quote_id IS NULL THEN
    v_city := NULLIF(
      pg_catalog.btrim(COALESCE(NEW.shipping_address ->> 'city', '')),
      ''
    );
    v_state := NULLIF(
      pg_catalog.btrim(COALESCE(NEW.shipping_address ->> 'state', '')),
      ''
    );

    IF v_city IS NULL OR v_state IS NULL
      OR (
        pg_catalog.lower(v_city) = 'airport'
        AND pg_catalog.lower(v_state) = 'nigeria'
      ) THEN
      RAISE EXCEPTION 'Airport pickup location is required'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_storefront_airport_pickup_location()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS validate_storefront_airport_pickup_location ON public.orders;

CREATE TRIGGER validate_storefront_airport_pickup_location
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_storefront_airport_pickup_location();

COMMENT ON FUNCTION private.validate_storefront_airport_pickup_location() IS
  'Requires a concrete city and state for fixed airport-pickup orders.';
