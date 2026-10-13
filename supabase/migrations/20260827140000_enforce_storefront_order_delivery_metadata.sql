-- Persist the delivery discriminator that the storefront validates before
-- calling the order RPC, and enforce the airport fee again at the database
-- boundary. The existing public RPC signatures are intentionally preserved;
-- route-owned context travels through reserved ad_tracking keys and is removed
-- before the value is stored.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS airport_type text;

COMMENT ON COLUMN public.orders.delivery_method IS
  'Checkout delivery method captured at order creation (door, pickup, airport, or pickup_station).';

COMMENT ON COLUMN public.orders.airport_type IS
  'Airport fulfillment mode for airport orders (delivery or pickup).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_delivery_method_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_method_check
      CHECK (
        delivery_method IS NULL
        OR delivery_method IN ('pickup', 'door', 'airport', 'pickup_station')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_airport_type_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_airport_type_check
      CHECK (airport_type IS NULL OR airport_type IN ('delivery', 'pickup'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_airport_type_method_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_airport_type_method_check
      CHECK (airport_type IS NULL OR delivery_method = 'airport');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_storefront_order_delivery_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_method text;
  v_airport_type text;
  v_address_marker text;
  v_quote_provider text;
  v_quote_rate_id text;
  v_quote_service_tier text;
  v_quote_price numeric;
  v_quote_expires_at timestamptz;
BEGIN
  -- The API writes these keys after validating the request. Direct callers
  -- may also populate the new columns, so the trigger accepts either source.
  v_delivery_method := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(
        COALESCE(
          NEW.delivery_method,
          NEW.ad_tracking ->> '__baci_delivery_method',
          ''
        )
      )
    ),
    ''
  );
  v_airport_type := NULLIF(
    pg_catalog.lower(
      pg_catalog.btrim(
        COALESCE(NEW.airport_type, NEW.ad_tracking ->> '__baci_airport_type', '')
      )
    ),
    ''
  );

  -- Preserve the legacy airport labels used by older clients, but do not
  -- infer airport delivery from a fee amount alone.
  v_address_marker := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(NEW.shipping_address ->> 'address', ''))
  );
  IF v_delivery_method IS NULL AND v_airport_type IS NULL THEN
    IF v_address_marker = 'airport pickup' THEN
      v_delivery_method := 'airport';
      v_airport_type := 'pickup';
    ELSIF v_address_marker IN (
      'airport delivery',
      'airport delivery (outside lagos)'
    ) THEN
      v_delivery_method := 'airport';
      v_airport_type := 'delivery';
    END IF;
  ELSIF v_delivery_method = 'airport' AND v_airport_type IS NULL THEN
    IF v_address_marker = 'airport pickup' THEN
      v_airport_type := 'pickup';
    ELSIF v_address_marker IN (
      'airport delivery',
      'airport delivery (outside lagos)'
    ) THEN
      v_airport_type := 'delivery';
    END IF;
  END IF;

  IF v_delivery_method IS NOT NULL AND v_delivery_method NOT IN (
    'pickup',
    'door',
    'airport',
    'pickup_station'
  ) THEN
    RAISE EXCEPTION 'Invalid storefront delivery method'
      USING ERRCODE = '22023';
  END IF;

  IF v_airport_type IS NOT NULL AND v_airport_type NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'Invalid airport fulfillment type'
      USING ERRCODE = '22023';
  END IF;

  IF v_delivery_method IS DISTINCT FROM 'airport' AND v_airport_type IS NOT NULL THEN
    RAISE EXCEPTION 'Airport fulfillment type requires airport delivery'
      USING ERRCODE = '22023';
  END IF;

  IF v_delivery_method = 'airport' THEN
    IF NEW.selected_quote_id IS NULL THEN
      IF v_airport_type IS NULL THEN
        RAISE EXCEPTION 'Airport fulfillment type is required for local airport delivery'
          USING ERRCODE = '22023';
      END IF;

      IF pg_catalog.abs(
        COALESCE(NEW.shipping_fee, 0)
        - CASE v_airport_type
            WHEN 'delivery' THEN 35000::numeric
            WHEN 'pickup' THEN 20000::numeric
          END
      ) > 0.01 THEN
        RAISE EXCEPTION 'Shipping fee does not match the selected local airport fee'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      -- Provider-backed airport delivery is only valid for a merchant-scoped
      -- GIGL HomeDelivery GoFaster quote whose stored price is charged.
      IF pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.shipping_provider, ''))) <> 'gigl' THEN
        RAISE EXCEPTION 'Airport provider quote must use GIGL'
          USING ERRCODE = '22023';
      END IF;

      SELECT
        sq.provider,
        sq.provider_rate_id,
        sq.service_tier,
        sq.price,
        sq.expires_at
      INTO
        v_quote_provider,
        v_quote_rate_id,
        v_quote_service_tier,
        v_quote_price,
        v_quote_expires_at
      FROM public.shipping_quotes AS sq
      WHERE sq.id = NEW.selected_quote_id
        AND sq.merchant_id = NEW.merchant_id
      LIMIT 1;

      IF FOUND
        AND v_quote_expires_at IS NOT NULL
        AND v_quote_expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'The selected airport delivery quote has expired'
          USING ERRCODE = '22023';
      END IF;

      IF NOT FOUND
        OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_quote_provider, ''))) <> 'GIGL'
        OR pg_catalog.btrim(COALESCE(v_quote_rate_id, '')) = ''
        OR pg_catalog.split_part(v_quote_rate_id, '_', 1) <> 'GIGL'
        OR pg_catalog.split_part(v_quote_rate_id, '_', 2) = 'INTL'
        OR pg_catalog.split_part(v_quote_rate_id, '_', 3) <> '0'
        OR pg_catalog.split_part(v_quote_rate_id, '_', 6) <> '1'
        OR (
          v_quote_service_tier IS NOT NULL
          AND NOT pg_catalog.lower(pg_catalog.btrim(v_quote_service_tier)) LIKE '%gofaster%'
        )
        OR v_quote_expires_at IS NULL
        OR v_quote_expires_at <= pg_catalog.now()
        OR v_quote_price IS NULL
        OR NEW.shipping_fee IS NULL
        OR pg_catalog.abs(NEW.shipping_fee - v_quote_price) > 0.01 THEN
        RAISE EXCEPTION 'Selected airport delivery quote is invalid or expired'
          USING ERRCODE = '22023';
      END IF;

      IF v_airport_type IS NOT NULL AND v_airport_type <> 'delivery' THEN
        RAISE EXCEPTION 'Provider-backed airport quote must be airport delivery'
          USING ERRCODE = '22023';
      END IF;
      v_airport_type := 'delivery';
    END IF;
  END IF;

  NEW.delivery_method := v_delivery_method;
  NEW.airport_type := CASE
    WHEN v_delivery_method = 'airport' THEN v_airport_type
    ELSE NULL
  END;

  -- The reserved transport keys are server context, not analytics data.
  IF pg_catalog.jsonb_typeof(NEW.ad_tracking) = 'object' THEN
    NEW.ad_tracking := NEW.ad_tracking
      - '__baci_delivery_method'
      - '__baci_airport_type';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_storefront_order_delivery_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS validate_storefront_order_delivery_metadata ON public.orders;

CREATE TRIGGER validate_storefront_order_delivery_metadata
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_storefront_order_delivery_metadata();

COMMENT ON FUNCTION private.validate_storefront_order_delivery_metadata() IS
  'Persists server-owned storefront delivery metadata and enforces local airport fees and eligible GIGL GoFaster quotes at the orders insert boundary.';
