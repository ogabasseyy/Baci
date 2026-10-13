-- Keep legacy idempotent-replay metadata repair behind the same signed route
-- context as order creation. The API cannot use a service-role UPDATE for a
-- guest replay, and a raw UPDATE would let retry metadata relabel an ordinary
-- legacy order as an airport order.

CREATE OR REPLACE FUNCTION public.persist_storefront_order_delivery_metadata(
  p_order_id uuid,
  p_delivery_method text DEFAULT NULL,
  p_airport_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_order RECORD;
  v_delivery_method text := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(p_delivery_method, ''))),
    ''
  );
  v_airport_type text := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(p_airport_type, ''))),
    ''
  );
  v_existing_delivery_method text;
  v_existing_airport_type text;
  v_marker text;
  v_durable_airport_type text;
  v_quote_provider text;
  v_quote_rate_id text;
  v_quote_service_tier text;
BEGIN
  IF COALESCE(v_jwt ->> 'storefront_order_context', '') <> 'route' THEN
    RAISE EXCEPTION 'storefront_order_route_context_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_delivery_method IS NOT NULL
     AND v_delivery_method NOT IN ('pickup', 'door', 'airport', 'pickup_station')
  THEN
    RAISE EXCEPTION 'Invalid storefront delivery method'
      USING ERRCODE = '22023';
  END IF;

  IF v_airport_type IS NOT NULL
     AND v_airport_type NOT IN ('delivery', 'pickup')
  THEN
    RAISE EXCEPTION 'Invalid airport fulfillment type'
      USING ERRCODE = '22023';
  END IF;

  IF v_airport_type IS NOT NULL AND v_delivery_method IS DISTINCT FROM 'airport' THEN
    RAISE EXCEPTION 'Airport fulfillment type requires airport delivery'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    o.merchant_id,
    o.checkout_idempotency_key,
    o.delivery_method,
    o.airport_type,
    o.shipping_address,
    o.selected_quote_id,
    o.shipping_provider,
    o.shipping_status
  INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_order.merchant_id::text IS DISTINCT FROM NULLIF(
       pg_catalog.btrim(v_jwt ->> 'storefront_order_merchant_id'),
       ''
     )
     OR v_order.checkout_idempotency_key IS NULL
     OR v_order.shipping_status IS DISTINCT FROM 'pending'
  THEN
    RETURN false;
  END IF;

  v_existing_delivery_method := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(v_order.delivery_method, ''))),
    ''
  );
  v_existing_airport_type := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(COALESCE(v_order.airport_type, ''))),
    ''
  );
  v_marker := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(v_order.shipping_address ->> 'address', ''))
  );

  -- A legacy provider-backed airport order has a durable quote discriminator;
  -- a fee amount alone is deliberately insufficient. Scalar targets remain
  -- NULL when the old quote row has been deleted.
  IF v_order.selected_quote_id IS NOT NULL THEN
    SELECT
      sq.provider,
      sq.provider_rate_id,
      sq.service_tier
    INTO
      v_quote_provider,
      v_quote_rate_id,
      v_quote_service_tier
    FROM public.shipping_quotes AS sq
    WHERE sq.id = v_order.selected_quote_id
      AND sq.merchant_id = v_order.merchant_id
    LIMIT 1;
  END IF;

  -- Existing non-airport metadata is authoritative. Retry fields must never
  -- be able to relabel a door, pickup-station, or merchant-rate order.
  IF v_existing_delivery_method IS NOT NULL
     AND v_existing_delivery_method <> 'airport'
  THEN
    RETURN false;
  END IF;

  v_durable_airport_type := CASE
    WHEN v_existing_airport_type IN ('delivery', 'pickup') THEN v_existing_airport_type
    WHEN v_marker = 'airport pickup' THEN 'pickup'
    WHEN v_marker IN ('airport delivery', 'airport delivery (outside lagos)') THEN 'delivery'
    WHEN v_quote_provider IS NOT NULL
      AND pg_catalog.upper(pg_catalog.btrim(v_quote_provider)) = 'GIGL'
      AND pg_catalog.btrim(COALESCE(v_quote_rate_id, '')) <> ''
      AND pg_catalog.split_part(v_quote_rate_id, '_', 1) = 'GIGL'
      AND pg_catalog.split_part(v_quote_rate_id, '_', 2) <> 'INTL'
      AND pg_catalog.split_part(v_quote_rate_id, '_', 3) = '0'
      AND pg_catalog.split_part(v_quote_rate_id, '_', 6) = '1'
      AND (
        v_quote_service_tier IS NULL
        OR pg_catalog.lower(pg_catalog.btrim(v_quote_service_tier)) LIKE '%gofaster%'
      ) THEN 'delivery'
    ELSE NULL
  END;

  IF v_durable_airport_type IS NULL THEN
    RETURN false;
  END IF;

  -- A retry may fill a missing complementary field, but it cannot contradict
  -- the discriminator already persisted on the original order.
  IF v_delivery_method IS NOT NULL AND v_delivery_method <> 'airport' THEN
    RETURN false;
  END IF;
  IF v_airport_type IS NOT NULL AND v_airport_type <> v_durable_airport_type THEN
    RETURN false;
  END IF;

  -- The replay trigger is intentionally scoped to the create RPC. Set its
  -- transaction-local marker for this narrowly authorized metadata repair.
  PERFORM pg_catalog.set_config(
    'baci.storefront_order_replay_context',
    'create_storefront_order',
    true
  );

  UPDATE public.orders AS o
  SET
    delivery_method = COALESCE(o.delivery_method, 'airport'),
    airport_type = COALESCE(o.airport_type, v_durable_airport_type)
  WHERE o.id = p_order_id
    AND o.merchant_id = v_order.merchant_id
    AND (o.delivery_method IS NULL OR o.delivery_method = 'airport');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_storefront_order_delivery_metadata(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_storefront_order_delivery_metadata(uuid, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.persist_storefront_order_delivery_metadata(uuid, text, text) IS
  'Route-scoped, replay-only repair of missing storefront delivery metadata; fee values and retry metadata never relabel an ordinary order.';
