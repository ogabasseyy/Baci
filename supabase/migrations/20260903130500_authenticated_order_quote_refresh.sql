-- User-facing, order-scoped wallet quote refresh. Binds the replacement quote
-- and attestation to the order while the caller is the merchant owner or a
-- staff member with orders:fulfill (matching the booking API gate).

CREATE OR REPLACE FUNCTION public.persist_refreshed_order_shipping_quote(
  p_order_id uuid,
  p_quote jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote_id uuid := (p_quote->>'id')::uuid;
  v_merchant_id uuid;
  v_price numeric := (p_quote->>'price')::numeric;
  v_cost numeric := NULLIF(p_quote->>'provider_cost', '')::numeric;
  v_margin numeric := NULLIF(p_quote->>'platform_margin', '')::numeric;
  v_bps integer := NULLIF(p_quote->>'platform_margin_bps', '')::integer;
  v_expires timestamptz := (p_quote->>'expires_at')::timestamptz;
  v_request jsonb := p_quote->'quote_request';
  v_rate_id text := p_quote->>'provider_rate_id';
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL
     OR jsonb_typeof(p_quote) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_order.shipment_id IS NOT NULL
     OR v_order.tracking_number IS NOT NULL
     OR v_order.cancelled_at IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'order_not_found_or_already_booked' USING ERRCODE = '22023';
  END IF;

  v_merchant_id := v_order.merchant_id;
  IF NOT public.check_staff_permission(
    auth.uid(), v_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Economics are not caller-selected: accept only the canonical GIGL
  -- pricing snapshot (10% margin, rounded in kobo) and never raw metadata.
  IF v_quote_id IS NULL
     OR p_quote->>'provider' <> 'GIGL'
     OR p_quote->>'currency' <> 'NGN'
     OR v_price IS NULL OR v_price <= 0
     OR v_cost IS NULL OR v_cost <= 0
     OR v_margin IS NULL OR v_margin < 0
     OR v_bps <> 1000
     OR v_price <> v_cost + v_margin
     OR v_price <> ceil((round(v_cost * 100) * 1100) / 100000.0)
     OR p_quote->>'pricing_version' <> 'gigl_platform_margin_v1'
     OR COALESCE((p_quote->>'is_station_pickup')::boolean, false)
     OR v_expires IS NULL OR v_expires <= now()
     OR v_request IS NULL OR v_request = 'null'::jsonb THEN
    RAISE EXCEPTION 'invalid_refreshed_quote' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipping_quote_attestations
    WHERE quote_id = v_quote_id
  ) THEN
    RAISE EXCEPTION 'attested_shipping_quote_immutable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    provider_cost, platform_margin, platform_margin_bps, pricing_version, currency,
    estimated_days, min_days, max_days, pickup_included, insurance_included,
    is_station_pickup, station_name, station_address, provider_rate_id,
    provider_metadata, expires_at, quote_request
  ) VALUES (
    v_quote_id, v_merchant_id, p_order_id::text, 'GIGL',
    p_quote->>'service_tier', p_quote->>'carrier_name', v_price,
    v_cost, v_margin, v_bps, 'gigl_platform_margin_v1', 'NGN',
    NULLIF(p_quote->>'estimated_days', '')::integer,
    NULLIF(p_quote->>'min_days', '')::integer,
    NULLIF(p_quote->>'max_days', '')::integer,
    COALESCE((p_quote->>'pickup_included')::boolean, false),
    COALESCE((p_quote->>'insurance_included')::boolean, false),
    false, NULL, NULL, v_rate_id,
    NULL, v_expires, v_request
  );

  INSERT INTO public.shipping_quote_attestations (
    quote_id, order_id, merchant_id, price, provider_cost, platform_margin,
    currency, pricing_version, expires_at, is_station_pickup, provider_rate_id,
    quote_request
  ) VALUES (
    v_quote_id, p_order_id, v_merchant_id, v_price, v_cost, v_margin,
    'NGN', 'gigl_platform_margin_v1', v_expires, false, v_rate_id, v_request
  );

  UPDATE public.orders
  SET selected_quote_id = v_quote_id,
      shipping_provider_cost = v_cost,
      shipping_platform_margin = v_margin,
      shipping_pricing_version = 'gigl_platform_margin_v1',
      shipping_funding_source = 'merchant_wallet',
      shipping_platform_retained_amount = 0
  WHERE id = p_order_id;

  RETURN v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb)
  TO authenticated;
