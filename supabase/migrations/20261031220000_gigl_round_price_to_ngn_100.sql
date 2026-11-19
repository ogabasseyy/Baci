-- Round new GIGL quote prices up to the next whole NGN 100.
--
-- apps/web/src/lib/shipping/gigl-platform-pricing.ts now prices a GIGL quote
-- as provider_cost + at least 10%, ceiled to the kobo, then rounded up to the
-- next whole NGN 100; the margin absorbs the rounding (margin = price - cost).
-- pricing_version stays 'gigl_platform_margin_v1' and platform_margin_bps stays
-- 1000, which is now the minimum margin rather than the exact one. v1 rows
-- created before this rule deployed hold the unrounded price.
--
-- The two quote writers that recompute the v1 price now accept either v1
-- price for the given cost: the unrounded one (quotes in flight during the
-- deploy, and replacement quotes for orders already paid at an unrounded fee)
-- or the NGN 100 rounded one. Any other price is still rejected. Apply this
-- migration before the web deploy: the old web code keeps working against it.
--
-- Both function bodies are copied from their current definitions
-- (persist_authenticated_admin_gigl_quote from 20260903134000,
-- persist_refreshed_order_shipping_quote from 20260904123300); only the
-- expected-price check changes. SECURITY DEFINER, the pinned search_path and
-- the grants are unchanged and restated: since 20260903135000 neither 2-arg
-- writer is executable by PUBLIC, anon or authenticated; clients reach them
-- only through the proof-bound 3-arg wrappers and the recovery confirm RPC,
-- all SECURITY DEFINER.

CREATE OR REPLACE FUNCTION private.gigl_v1_price_matches_cost(
  p_provider_cost numeric,
  p_price numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  -- Unrounded v1: ceil((round(cost*100) * 11000) / 10000) / 100.
  -- Rounded v1: that kobo amount rounded up to a multiple of 10000 kobo.
  SELECT p_provider_cost IS NOT NULL
    AND p_provider_cost > 0
    AND p_price IS NOT NULL
    AND p_price IN (
      ceil((round(p_provider_cost * 100) * 11000) / 10000.0) / 100.0,
      ceil(ceil((round(p_provider_cost * 100) * 11000) / 10000.0) / 10000.0)
        * 100
    );
$$;

REVOKE ALL ON FUNCTION private.gigl_v1_price_matches_cost(numeric, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.persist_authenticated_admin_gigl_quote(
  p_quote jsonb,
  p_attestation jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote_id uuid;
  v_order_id uuid;
  v_merchant_id uuid;
  v_price numeric;
  v_cost numeric;
  v_margin numeric;
  v_bps integer;
  v_currency text;
  v_version text;
  v_expires timestamptz;
  v_station boolean;
  v_rate_id text;
  v_request jsonb;
BEGIN
  v_quote_id := (p_quote->>'id')::uuid;
  v_order_id := (p_attestation->>'order_id')::uuid;
  v_merchant_id := (p_attestation->>'merchant_id')::uuid;
  v_price := (p_quote->>'price')::numeric;
  v_cost := NULLIF(p_quote->>'provider_cost', '')::numeric;
  v_margin := NULLIF(p_quote->>'platform_margin', '')::numeric;
  v_bps := NULLIF(p_quote->>'platform_margin_bps', '')::integer;
  v_currency := p_quote->>'currency';
  v_version := p_quote->>'pricing_version';
  v_expires := (p_quote->>'expires_at')::timestamptz;
  v_station := COALESCE((p_quote->>'is_station_pickup')::boolean, false);
  v_rate_id := COALESCE(
    p_quote->>'provider_rate_id',
    p_attestation->>'provider_rate_id'
  );
  v_request := p_attestation->'quote_request';

  IF auth.uid() IS NULL
     OR NOT public.check_staff_permission(
       auth.uid(), v_merchant_id, 'orders', 'fulfill'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_quote_id IS NULL OR v_order_id IS NULL OR v_merchant_id IS NULL
     OR p_quote->>'provider' <> 'GIGL' OR v_currency <> 'NGN'
     OR v_version <> 'gigl_platform_margin_v1' OR v_station
     OR v_price IS NULL OR v_price <= 0
     OR v_cost IS NULL OR v_cost <= 0
     OR v_margin IS NULL OR v_margin < 0
     OR v_bps <> 1000
     OR v_price <> v_cost + v_margin
     OR private.gigl_v1_price_matches_cost(v_cost, v_price) IS DISTINCT FROM true
     OR v_expires IS NULL OR v_expires <= now()
     OR v_request IS NULL OR v_request = 'null'::jsonb THEN
    RAISE EXCEPTION 'invalid_admin_quote' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = v_order_id
      AND o.merchant_id = v_merchant_id
      AND o.shipment_id IS NULL
      AND o.tracking_number IS NULL
      AND o.cancelled_at IS NULL
      AND lower(COALESCE(o.shipping_status, '')) = 'processing'
  ) THEN
    RAISE EXCEPTION 'order_not_found_or_already_booked' USING ERRCODE = '22023';
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
    v_quote_id, v_merchant_id, v_order_id::text, 'GIGL',
    p_quote->>'service_tier', p_quote->>'carrier_name', v_price,
    v_cost, v_margin, v_bps, v_version, v_currency,
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
    v_quote_id, v_order_id, v_merchant_id, v_price, v_cost, v_margin,
    v_currency, v_version, v_expires, false, v_rate_id, v_request
  );

  RETURN v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

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
  v_preserve_checkout boolean := false;
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

  v_preserve_checkout :=
    v_order.shipping_funding_source = 'customer_checkout'
    AND COALESCE(v_order.shipping_platform_retained_amount, 0) > 0;

  -- Mirror apps/web/src/lib/shipping/gigl-platform-pricing.ts: either the
  -- NGN 100 rounded v1 price or the unrounded v1 price for this cost.
  IF v_quote_id IS NULL
     OR p_quote->>'provider' <> 'GIGL'
     OR p_quote->>'currency' <> 'NGN'
     OR v_price IS NULL OR v_price <= 0
     OR v_cost IS NULL OR v_cost <= 0
     OR v_margin IS NULL OR v_margin < 0
     OR v_bps <> 1000
     OR v_price <> v_cost + v_margin
     OR private.gigl_v1_price_matches_cost(v_cost, v_price) IS DISTINCT FROM true
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
      shipping_provider_cost = CASE
        WHEN v_preserve_checkout THEN v_order.shipping_provider_cost
        ELSE v_cost
      END,
      shipping_platform_margin = CASE
        WHEN v_preserve_checkout THEN v_order.shipping_platform_margin
        ELSE v_margin
      END,
      shipping_pricing_version = CASE
        WHEN v_preserve_checkout THEN v_order.shipping_pricing_version
        ELSE 'gigl_platform_margin_v1'
      END,
      shipping_funding_source = CASE
        WHEN v_preserve_checkout THEN 'customer_checkout'
        ELSE 'merchant_wallet'
      END,
      shipping_platform_retained_amount = CASE
        WHEN v_preserve_checkout THEN v_order.shipping_platform_retained_amount
        ELSE 0
      END
  WHERE id = p_order_id;

  RETURN v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
