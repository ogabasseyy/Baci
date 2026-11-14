-- Fixtures for paystack_direct_split_settlement_history.sql (\ir part).

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.fid(p_kind integer, p_n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.format(
    'd5e70%s00-0000-4000-8000-%s', p_kind, pg_catalog.lpad(p_n::text, 12, '0')
  )::uuid
$$;

CREATE FUNCTION pg_temp.merchant() RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT pg_temp.fid(1, 1) $$;

CREATE FUNCTION pg_temp.wallet() RETURNS public.merchant_wallets
LANGUAGE sql STABLE AS $$
  SELECT w.* FROM public.merchant_wallets AS w WHERE w.merchant_id = pg_temp.merchant()
$$;

CREATE FUNCTION pg_temp.as_service_role() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
  SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

CREATE FUNCTION pg_temp.as_owner() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT pg_catalog.set_config('request.jwt.claim.sub', 'd5e70000-0000-4000-8000-000000000001', true);
  SELECT pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"d5e70000-0000-4000-8000-000000000001"}',
    true
  );
$$;

-- A paid order. p_payment_method 'uba_redvault' marks a REDVAULT sale.
CREATE FUNCTION pg_temp.seed_order(
  p_n integer, p_total numeric, p_payment_method text DEFAULT 'card'
) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, payment_status,
    shipping_status, payment_method, customer_email
  ) VALUES (
    pg_temp.fid(2, p_n), pg_temp.merchant(), 'PDS-' || p_n, p_total, p_total,
    'paid', 'processing', p_payment_method, 'pds-buyer@example.test'
  );
  RETURN pg_temp.fid(2, p_n);
END $$;

-- Attach an attested GIGL quote; the economics trigger stamps the order.
CREATE FUNCTION pg_temp.attach_gigl_quote(
  p_n integer, p_price numeric, p_funding text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_order constant uuid := pg_temp.fid(2, p_n);
  v_quote constant uuid := pg_temp.fid(3, p_n);
BEGIN
  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    provider_cost, platform_margin, pricing_version, currency,
    is_station_pickup, provider_rate_id, expires_at, quote_request
  ) VALUES (
    v_quote, pg_temp.merchant(), v_order::text, 'GIGL', 'standard',
    'GIG Logistics', p_price, p_price - 1000, 1000, 'gigl_platform_margin_v1',
    'NGN', false, 'pds-rate-' || p_n, now() + interval '1 hour',
    jsonb_build_object('fixture', p_n)
  );
  INSERT INTO public.shipping_quote_attestations (
    quote_id, order_id, merchant_id, price, provider_cost, platform_margin,
    currency, pricing_version, expires_at, is_station_pickup,
    provider_rate_id, quote_request
  )
  SELECT q.id, v_order, q.merchant_id, q.price, q.provider_cost,
    q.platform_margin, q.currency, q.pricing_version, q.expires_at,
    q.is_station_pickup, q.provider_rate_id, q.quote_request
  FROM public.shipping_quotes AS q WHERE q.id = v_quote;
  UPDATE public.orders
  SET selected_quote_id = v_quote, shipping_provider = 'GIGL',
      shipping_funding_source = p_funding
  WHERE id = v_order;
END $$;

-- A legacy Paystack wallet credit, made the way production made them before
-- 20261103084500: record_merchant_settlement, then maturity.
CREATE FUNCTION pg_temp.legacy_paystack_credit(
  p_n integer, p_gross numeric, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid := pg_temp.seed_order(p_n, p_gross);
  v_settlement uuid;
BEGIN
  v_settlement := public.record_merchant_settlement(
    pg_temp.merchant(), 'order', v_order, 'paystack', 'PDS-REF-' || p_n,
    p_gross, 0, 0, 'Order payment via paystack', p_metadata
  );
  PERFORM pg_temp.check(v_settlement IS NOT NULL, 'fixture settlement missing');
  UPDATE public.merchant_settlements
  SET expected_settlement_date = current_date
  WHERE id = v_settlement;
  PERFORM public.process_due_settlements();
  PERFORM pg_temp.check(
    (SELECT status FROM public.merchant_settlements WHERE id = v_settlement) = 'settled',
    'fixture settlement did not mature');
  RETURN v_settlement;
END $$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'd5e70000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'paystack-direct-split-owner@example.test', 'test', now(), now(), now(),
  '{}'::jsonb, '{}'::jsonb
);

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, paystack_subaccount_code
) VALUES (
  pg_temp.merchant(), 'd5e70000-0000-4000-8000-000000000001',
  'paystack-direct-split-owner@example.test', 'Paystack Direct Split Fixture',
  'paystack-direct-split-fixture', 'ACCT_pdsfixture'
);

-- GIGL orders need the carrier enabled for the merchant
-- (private.enforce_merchant_shipping_provider_enabled).
INSERT INTO public.merchant_feature_settings (merchant_id, shipping_providers)
VALUES (pg_temp.merchant(), '["gigl"]'::jsonb)
ON CONFLICT (merchant_id) DO UPDATE
  SET shipping_providers = EXCLUDED.shipping_providers;

INSERT INTO public.merchant_wallets (merchant_id, available_balance)
VALUES (pg_temp.merchant(), 0);
