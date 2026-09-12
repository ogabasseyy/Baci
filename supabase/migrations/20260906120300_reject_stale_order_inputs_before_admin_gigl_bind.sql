-- Reject concurrent order address/item edits that diverge from the attested
-- admin GIGL quote before binding overwrites the order with the earlier snapshot.

CREATE OR REPLACE FUNCTION public.bind_admin_gigl_quote(
  p_order_id uuid,
  p_merchant_id uuid,
  p_quote_id uuid,
  p_receiver jsonb
)
RETURNS TABLE (quote jsonb, available_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipping_funding_source = 'customer_checkout'
     AND private.order_settled_gigl_retained_amount(p_order_id, p_merchant_id) > 0 THEN
    RAISE EXCEPTION 'customer_checkout_wallet_rebind_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id = p_quote_id FOR UPDATE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.is_station_pickup
     OR v_quote.expires_at <= now()
     OR v_quote.price <= 0
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.quote_request->'receiver' IS DISTINCT FROM p_receiver THEN
    RAISE EXCEPTION 'invalid_quote_attestation';
  END IF;
  SELECT COALESCE(w.available_balance, 0)
  INTO v_balance
  FROM public.merchant_wallets w
  WHERE w.merchant_id = p_merchant_id
  FOR UPDATE;
  -- Reject concurrent address/item edits that diverged from the attested quote
  -- before overwriting the order with the earlier receiver snapshot.
  IF jsonb_strip_nulls(
       jsonb_build_object(
         'address', COALESCE(NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'address'), ''), ''),
         'city', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'city'), ''),
         'name', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'name'), ''),
         'phone', COALESCE(NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'phone'), ''), ''),
         'state', NULLIF(btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'state'), '')
       )
     ) IS DISTINCT FROM jsonb_strip_nulls(
       jsonb_build_object(
         'address', COALESCE(NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'address'), ''), ''),
         'city', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'city'), ''),
         'name', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'name'), ''),
         'phone', COALESCE(NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'phone'), ''), ''),
         'state', NULLIF(btrim(COALESCE(p_receiver, '{}'::jsonb) ->> 'state'), '')
       )
     ) THEN
    RAISE EXCEPTION 'stale_order_quote_inputs' USING ERRCODE = 'P0001';
  END IF;

  IF (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', btrim(oi.name),
          'quantity', oi.quantity,
          'price', oi.price
        )
        ORDER BY btrim(oi.name), oi.price, oi.quantity
      ),
      '[]'::jsonb
    )
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
  ) IS DISTINCT FROM (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', btrim(COALESCE(item ->> 'name', '')),
          'quantity', COALESCE(NULLIF(item ->> 'quantity', '')::integer, 0),
          'price', COALESCE(
            NULLIF(item ->> 'value', '')::numeric,
            NULLIF(item ->> 'price', '')::numeric,
            0::numeric
          )
        )
        ORDER BY btrim(COALESCE(item ->> 'name', '')),
          COALESCE(
            NULLIF(item ->> 'value', '')::numeric,
            NULLIF(item ->> 'price', '')::numeric,
            0::numeric
          ),
          COALESCE(NULLIF(item ->> 'quantity', '')::integer, 0)
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(v_attestation.quote_request -> 'items', '[]'::jsonb)) = 'array'
          THEN COALESCE(v_attestation.quote_request -> 'items', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS item
  ) THEN
    RAISE EXCEPTION 'stale_order_quote_inputs' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET selected_quote_id = p_quote_id,
      shipping_provider = 'GIGL',
      shipping_address = p_receiver,
      shipping_funding_source = 'merchant_wallet'
  WHERE id = p_order_id;
  RETURN QUERY SELECT jsonb_build_object(
    'id', v_quote.id,
    'merchant_id', v_quote.merchant_id,
    'session_id', v_quote.session_id,
    'provider', v_quote.provider,
    'service_tier', v_quote.service_tier,
    'carrier_name', v_quote.carrier_name,
    'price', v_quote.price,
    'currency', v_quote.currency,
    'estimated_days', v_quote.estimated_days,
    'min_days', v_quote.min_days,
    'max_days', v_quote.max_days,
    'pickup_included', v_quote.pickup_included,
    'insurance_included', v_quote.insurance_included,
    'provider_rate_id', v_quote.provider_rate_id,
    'is_station_pickup', v_quote.is_station_pickup,
    'station_name', v_quote.station_name,
    'station_address', v_quote.station_address,
    'quote_request', v_quote.quote_request,
    'used', v_quote.used,
    'expires_at', v_quote.expires_at,
    'created_at', v_quote.created_at
  ), v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  TO authenticated;

