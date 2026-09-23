-- Trusted Admin-order quote persistence. Only the existing service-role quote
-- edge may call this writer; authenticated clients have no table write grant.
ALTER TABLE public.shipping_quote_attestations
  ADD COLUMN IF NOT EXISTS provider_rate_id text,
  ADD COLUMN IF NOT EXISTS quote_request jsonb;
REVOKE ALL ON TABLE public.shipping_quote_attestations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.persist_admin_gigl_quote(
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
  v_currency := p_quote->>'currency';
  v_version := p_quote->>'pricing_version';
  v_expires := (p_quote->>'expires_at')::timestamptz;
  v_station := COALESCE((p_quote->>'is_station_pickup')::boolean, false);
  v_rate_id := p_quote->>'provider_rate_id';
  v_request := p_attestation->'quote_request';
  IF v_quote_id IS NULL OR v_order_id IS NULL OR v_merchant_id IS NULL
     OR p_quote->>'provider' <> 'GIGL' OR v_currency <> 'NGN'
     OR v_version <> 'gigl_platform_margin_v1' OR v_station OR v_price IS NULL OR v_price <= 0
     OR v_expires IS NULL OR v_expires <= now() OR v_request IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_quote';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = v_order_id AND o.merchant_id = v_merchant_id
      AND o.shipment_id IS NULL AND o.tracking_number IS NULL
      AND lower(COALESCE(o.shipping_status, '')) NOT IN ('shipped','booked','in_transit')
  ) THEN RAISE EXCEPTION 'order_not_found_or_already_booked'; END IF;

  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    provider_cost, platform_margin, platform_margin_bps, pricing_version, currency,
    estimated_days, min_days, max_days, pickup_included, insurance_included,
    is_station_pickup, station_name, station_address, provider_rate_id,
    provider_metadata, expires_at, quote_request
  ) VALUES (
    v_quote_id, v_merchant_id, v_order_id::text, p_quote->>'provider',
    p_quote->>'service_tier', p_quote->>'carrier_name', v_price, v_cost, v_margin,
    NULLIF(p_quote->>'platform_margin_bps', '')::integer, v_version, v_currency,
    (p_quote->>'estimated_days')::integer, NULLIF(p_quote->>'min_days','')::integer,
    NULLIF(p_quote->>'max_days','')::integer, COALESCE((p_quote->>'pickup_included')::boolean,false),
    COALESCE((p_quote->>'insurance_included')::boolean,false), v_station,
    p_quote->>'station_name', p_quote->>'station_address', v_rate_id,
    p_quote->'provider_metadata', v_expires, v_request
  );
  INSERT INTO public.shipping_quote_attestations (
    quote_id, order_id, merchant_id, price, provider_cost, platform_margin,
    currency, pricing_version, expires_at, is_station_pickup, provider_rate_id, quote_request
  ) VALUES (
    v_quote_id, v_order_id, v_merchant_id, v_price, v_cost, v_margin,
    v_currency, v_version, v_expires, v_station, v_rate_id, v_request
  );
  RETURN v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_admin_gigl_quote(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_admin_gigl_quote(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.prevent_attested_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shipping_quote_attestations a WHERE a.quote_id = COALESCE(NEW.id, OLD.id)) THEN
    RAISE EXCEPTION 'attested_shipping_quote_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_attested_quote_mutation ON public.shipping_quotes;
CREATE TRIGGER prevent_attested_quote_mutation
  BEFORE UPDATE OR DELETE ON public.shipping_quotes
  FOR EACH ROW EXECUTE FUNCTION private.prevent_attested_quote_mutation();

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
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL OR lower(COALESCE(v_order.shipping_status,'')) IN ('shipped','booked','in_transit') THEN RAISE EXCEPTION 'order_already_shipped_or_booked'; END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id = p_quote_id FOR UPDATE;
  SELECT * INTO v_attestation FROM public.shipping_quote_attestations WHERE quote_id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id OR v_quote.session_id IS DISTINCT FROM p_order_id::text
    OR v_quote.provider IS DISTINCT FROM 'GIGL' OR v_quote.currency IS DISTINCT FROM 'NGN' OR v_quote.is_station_pickup
    OR v_quote.expires_at <= now() OR v_quote.price <= 0 OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
    OR v_attestation.order_id IS DISTINCT FROM p_order_id OR v_attestation.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
    OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request
    OR v_attestation.price IS DISTINCT FROM v_quote.price
    OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
    OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
    OR v_attestation.currency IS DISTINCT FROM v_quote.currency
    OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
    OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
    OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup THEN RAISE EXCEPTION 'invalid_quote_attestation'; END IF;
  SELECT COALESCE(w.available_balance,0) INTO v_balance FROM public.merchant_wallets w WHERE w.merchant_id = p_merchant_id FOR UPDATE;
  UPDATE public.orders SET selected_quote_id = p_quote_id, shipping_provider = 'GIGL', shipping_address = p_receiver, shipping_funding_source = 'merchant_wallet' WHERE id = p_order_id;
  RETURN QUERY SELECT to_jsonb(v_quote), v_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) TO authenticated;
