-- Corrective follow-up for the Admin GIGL wallet migration review.
-- Keep merchant wallet account reads available to authenticated owners while
-- retaining service-role-only payment-account writes. Pending funding requests
-- remain insertable by their authenticated merchant owner.
REVOKE ALL ON TABLE public.merchant_wallet_funding_account_requests,
  public.merchant_wallet_payment_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_wallet_funding_account_requests,
  public.merchant_wallet_payment_accounts TO authenticated;
GRANT INSERT ON TABLE public.merchant_wallet_funding_account_requests TO authenticated;

-- Add indexes for every foreign key introduced by the GIGL wallet flow.
CREATE INDEX IF NOT EXISTS merchant_wallet_funding_account_requests_merchant_id_idx
  ON public.merchant_wallet_funding_account_requests (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_wallet_payment_accounts_merchant_id_idx
  ON public.merchant_wallet_payment_accounts (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_wallet_payment_accounts_request_id_idx
  ON public.merchant_wallet_payment_accounts (request_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_merchant_id_idx
  ON public.merchant_shipping_charges (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_order_id_idx
  ON public.merchant_shipping_charges (order_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_shipping_quote_id_idx
  ON public.merchant_shipping_charges (shipping_quote_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_debit_transaction_id_idx
  ON public.merchant_shipping_charges (debit_transaction_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_refund_transaction_id_idx
  ON public.merchant_shipping_charges (refund_transaction_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_shipment_id_idx
  ON public.merchant_shipping_charges (shipment_id);

-- Admin quotes and wallet bindings are valid only while an order is still in
-- the processing pipeline. The receiver is also bound to the attested request
-- so callers cannot redirect a trusted quote to a different address.
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
    WHERE o.id = v_order_id
      AND o.merchant_id = v_merchant_id
      AND o.shipment_id IS NULL
      AND o.tracking_number IS NULL
      AND lower(COALESCE(o.shipping_status, '')) = 'processing'
  ) THEN
    RAISE EXCEPTION 'order_not_found_or_already_booked';
  END IF;

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
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
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
  UPDATE public.orders
  SET selected_quote_id = p_quote_id,
      shipping_provider = 'GIGL',
      shipping_address = p_receiver,
      shipping_funding_source = 'merchant_wallet'
  WHERE id = p_order_id;
  RETURN QUERY SELECT to_jsonb(v_quote), v_balance;
END;
$$;

-- Keep the charge reservation result unambiguous for PL/pgSQL OUT parameters.
CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid,
  p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
  v_charge_id uuid;
  v_charge_status text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR SHARE;
  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = auth.uid()
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet' THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping:' || v_order.merchant_id || ':' || p_order_id, 0)
  );
  SELECT * INTO v_existing
  FROM public.merchant_shipping_charges
  WHERE order_id = p_order_id AND shipping_quote_id = p_quote_id
  FOR UPDATE;
  SELECT * INTO v_quote
  FROM public.shipping_quotes
  WHERE id = p_quote_id AND merchant_id = v_order.merchant_id
    AND provider = 'GIGL' AND currency = 'NGN'
  FOR SHARE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR SHARE;
  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL
     OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id
     OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_quote.is_station_pickup
     OR (v_existing.id IS NULL AND v_quote.expires_at <= now())
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN
    RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE = '22023';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
      SET attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    SELECT available_balance INTO balance_after
    FROM public.merchant_wallets WHERE merchant_id = v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount, balance_after, v_existing.status;
    RETURN;
  END IF;
  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < v_quote.price THEN
    RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance - v_quote.price, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type, source_id, description, status
  ) VALUES (
    v_wallet.id, v_order.merchant_id, 'debit', v_quote.price, balance_after,
    'gigl_shipping', p_order_id, 'GIGL shipping reservation', 'completed'
  ) RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges AS charge(
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, debit_transaction_id
  ) VALUES (
    v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
    v_quote.provider_cost, v_quote.platform_margin,
    pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), v_tx
  ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;
  RETURN QUERY SELECT v_charge_id, v_quote.price, balance_after, v_charge_status;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_admin_gigl_quote(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_admin_gigl_quote(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text) TO authenticated;
