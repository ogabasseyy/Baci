-- Checkout/book quote refresh must persist through the merchant's request
-- client. The previous helper constructed a service-role shipping_quotes
-- upsert and bypassed the economics column grant.

CREATE OR REPLACE FUNCTION public.persist_refreshed_merchant_shipping_quote(
  p_quote jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote_id uuid;
  v_merchant_id uuid;
  v_session_id text;
  v_provider text;
  v_price numeric;
  v_currency text;
  v_expires timestamptz;
  v_request jsonb;
BEGIN
  v_quote_id := (p_quote->>'id')::uuid;
  v_merchant_id := (p_quote->>'merchant_id')::uuid;
  v_session_id := p_quote->>'session_id';
  v_provider := p_quote->>'provider';
  v_price := (p_quote->>'price')::numeric;
  v_currency := p_quote->>'currency';
  v_expires := (p_quote->>'expires_at')::timestamptz;
  v_request := p_quote->'quote_request';

  IF v_quote_id IS NULL OR v_merchant_id IS NULL
     OR v_session_id IS NULL OR btrim(v_session_id) = ''
     OR v_provider IS NULL OR btrim(v_provider) = ''
     OR v_price IS NULL OR v_price <= 0
     OR v_currency IS NULL OR btrim(v_currency) = ''
     OR v_expires IS NULL OR v_expires <= now()
     OR v_request IS NULL OR v_request = 'null'::jsonb THEN
    RAISE EXCEPTION 'invalid_refreshed_quote' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants AS merchant
    WHERE merchant.id = v_merchant_id AND merchant.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipping_quote_attestations AS attestation
    WHERE attestation.quote_id = v_quote_id
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
    v_quote_id,
    v_merchant_id,
    v_session_id,
    v_provider,
    p_quote->>'service_tier',
    p_quote->>'carrier_name',
    v_price,
    NULLIF(p_quote->>'provider_cost', '')::numeric,
    NULLIF(p_quote->>'platform_margin', '')::numeric,
    NULLIF(p_quote->>'platform_margin_bps', '')::integer,
    p_quote->>'pricing_version',
    v_currency,
    NULLIF(p_quote->>'estimated_days', '')::integer,
    NULLIF(p_quote->>'min_days', '')::integer,
    NULLIF(p_quote->>'max_days', '')::integer,
    COALESCE((p_quote->>'pickup_included')::boolean, false),
    COALESCE((p_quote->>'insurance_included')::boolean, false),
    COALESCE((p_quote->>'is_station_pickup')::boolean, false),
    p_quote->>'station_name',
    p_quote->>'station_address',
    p_quote->>'provider_rate_id',
    p_quote->'provider_metadata',
    v_expires,
    v_request
  )
  ON CONFLICT (id) DO UPDATE SET
    session_id = EXCLUDED.session_id,
    provider = EXCLUDED.provider,
    service_tier = EXCLUDED.service_tier,
    carrier_name = EXCLUDED.carrier_name,
    price = EXCLUDED.price,
    provider_cost = EXCLUDED.provider_cost,
    platform_margin = EXCLUDED.platform_margin,
    platform_margin_bps = EXCLUDED.platform_margin_bps,
    pricing_version = EXCLUDED.pricing_version,
    currency = EXCLUDED.currency,
    estimated_days = EXCLUDED.estimated_days,
    min_days = EXCLUDED.min_days,
    max_days = EXCLUDED.max_days,
    pickup_included = EXCLUDED.pickup_included,
    insurance_included = EXCLUDED.insurance_included,
    is_station_pickup = EXCLUDED.is_station_pickup,
    station_name = EXCLUDED.station_name,
    station_address = EXCLUDED.station_address,
    provider_rate_id = EXCLUDED.provider_rate_id,
    provider_metadata = EXCLUDED.provider_metadata,
    expires_at = EXCLUDED.expires_at,
    quote_request = EXCLUDED.quote_request
  WHERE public.shipping_quotes.merchant_id IS NOT DISTINCT FROM EXCLUDED.merchant_id
  RETURNING id INTO v_quote_id;

  IF v_quote_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_refreshed_merchant_shipping_quote(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_refreshed_merchant_shipping_quote(jsonb)
  TO authenticated;
