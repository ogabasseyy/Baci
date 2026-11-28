-- BEHAVIOURAL TEST: platform-funded ("Baci pays") GIG charges.
-- A merchant flagged in private.platform_funded_gigl_merchants reserves a
-- funding_source = 'platform' charge without any wallet movement, and every
-- release path (refund RPC, order cancellation trigger, self-fulfilment)
-- marks the charge refunded while the wallet balance and wallet_transactions
-- stay untouched. A non-flagged merchant is the control: its reserve still
-- debits the wallet. Runs in one rolled-back transaction.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/platform_funded_gigl_shipping_release.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

CREATE FUNCTION pg_temp.act_as(p_user uuid)
RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true),
    pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text,
      true
    )
$$;

CREATE FUNCTION pg_temp.wallet_balance(p_merchant uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT available_balance FROM public.merchant_wallets WHERE merchant_id = p_merchant
$$;

CREATE FUNCTION pg_temp.wallet_tx_count(p_order uuid)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*) FROM public.wallet_transactions
  WHERE source_type = 'gigl_shipping' AND source_id = p_order
$$;

-- One processing GIGL order with an attested quote bound to the order.
CREATE FUNCTION pg_temp.seed_order(p_merchant uuid, p_n integer)
RETURNS void
LANGUAGE plpgsql
AS $seed$
DECLARE
  v_step text := 'order';
  v_order constant uuid := pg_catalog.format('b4c1%s000-0000-4000-8000-%s', 2, pg_catalog.lpad(p_n::text, 12, '0'))::uuid;
  v_quote constant uuid := pg_catalog.format('b4c1%s000-0000-4000-8000-%s', 3, pg_catalog.lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, payment_status,
    shipping_status
  ) VALUES (
    v_order, p_merchant, 'PLATFORM-FUNDED-' || p_n, 150000, 150000, 'paid',
    'processing'
  );
  v_step := 'quote';
  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    provider_cost, platform_margin, pricing_version, currency,
    is_station_pickup, provider_rate_id, expires_at, quote_request
  ) VALUES (
    v_quote, p_merchant, v_order::text, 'GIGL', 'standard', 'GIG Logistics',
    4500.00, 4000.00, 500.00, 'gigl_platform_margin_v1', 'NGN', false,
    'rate-' || p_n, now() + interval '1 hour', jsonb_build_object('fixture', p_n)
  );
  v_step := 'attestation';
  INSERT INTO public.shipping_quote_attestations (
    quote_id, order_id, merchant_id, price, provider_cost, platform_margin,
    currency, pricing_version, expires_at, is_station_pickup,
    provider_rate_id, quote_request
  )
  SELECT quote.id, v_order, quote.merchant_id, quote.price,
    quote.provider_cost, quote.platform_margin, quote.currency,
    quote.pricing_version, quote.expires_at, quote.is_station_pickup,
    quote.provider_rate_id, quote.quote_request
  FROM public.shipping_quotes AS quote WHERE quote.id = v_quote;
  v_step := 'bind';
  UPDATE public.orders
  SET selected_quote_id = v_quote, shipping_funding_source = 'merchant_wallet',
      shipping_provider = 'GIGL'
  WHERE id = v_order;
EXCEPTION WHEN OTHERS THEN
  -- The replay runner prints only the SQLSTATE, so encode the failing step in
  -- it: UF001 order, UF002 quote, UF003 attestation, UF004 bind.
  RAISE EXCEPTION 'seed_order % failed at %: % (%)', p_n, v_step, SQLERRM, SQLSTATE
    USING ERRCODE = CASE v_step
      WHEN 'order' THEN 'UF001' WHEN 'quote' THEN 'UF002'
      WHEN 'attestation' THEN 'UF003' ELSE 'UF004' END;
END;
$seed$;

-- Seeds a reserved platform charge (no debit) for order p_n.
CREATE FUNCTION pg_temp.seed_platform_charge(p_merchant uuid, p_n integer, p_token text)
RETURNS uuid
LANGUAGE plpgsql
AS $charge$
DECLARE
  v_order constant uuid := pg_catalog.format('b4c1%s000-0000-4000-8000-%s', 2, pg_catalog.lpad(p_n::text, 12, '0'))::uuid;
  v_quote constant uuid := pg_catalog.format('b4c1%s000-0000-4000-8000-%s', 3, pg_catalog.lpad(p_n::text, 12, '0'))::uuid;
  v_id uuid;
BEGIN
  INSERT INTO public.merchant_shipping_charges (
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, funding_source
  ) VALUES (
    p_merchant, v_order, v_quote, 'NGN', 4500.00, 4000.00, 500.00,
    pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex'), 'platform'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$charge$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('b4c10000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'platform-funded-owner@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb),
  ('b4c10000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'platform-funded-control@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb),
  ('b4c10000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'platform-funded-staff@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('b4c11000-0000-4000-8000-000000000001', 'b4c10000-0000-4000-8000-000000000001',
    'platform-funded-owner@example.test', 'Platform Funded Fixture', 'platform-funded-fixture'),
  ('b4c11000-0000-4000-8000-000000000002', 'b4c10000-0000-4000-8000-000000000002',
    'platform-funded-control@example.test', 'Platform Control Fixture', 'platform-control-fixture');

-- enforce_merchant_shipping_provider_enabled needs GIGL enabled per merchant.
INSERT INTO public.merchant_feature_settings (merchant_id, shipping_providers)
VALUES
  ('b4c11000-0000-4000-8000-000000000001', '["gigl"]'::jsonb),
  ('b4c11000-0000-4000-8000-000000000002', '["gigl"]'::jsonb)
ON CONFLICT (merchant_id) DO UPDATE SET shipping_providers = EXCLUDED.shipping_providers;

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  'b4c11000-0000-4000-8000-000000000001', 'b4c10000-0000-4000-8000-000000000003',
  'platform-funded-staff@example.test', 'Platform Funded Staff',
  'accountant', '{"orders":{"view":true,"fulfill":true}}'::jsonb, 'active'
);

INSERT INTO public.merchant_wallets (merchant_id, available_balance) VALUES
  ('b4c11000-0000-4000-8000-000000000001', 100000.00),
  ('b4c11000-0000-4000-8000-000000000002', 100000.00);

-- The owner flips the flag as postgres; only merchant 1 is platform funded.
INSERT INTO private.platform_funded_gigl_merchants (merchant_id)
VALUES ('b4c11000-0000-4000-8000-000000000001');

DO $seed_orders$
BEGIN
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 1); -- cancel
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 2); -- self-fulfil
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 3); -- refund RPC
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 4); -- reserve
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000002', 5); -- control reserve
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000002', 6); -- control cancel
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000002', 7); -- control self-fulfil
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 8); -- funded-wallet platform reserve
  PERFORM pg_temp.seed_order('b4c11000-0000-4000-8000-000000000001', 9); -- no-wallet-row platform reserve
END;
$seed_orders$;

\ir platform_funded_gigl_shipping_release.cases.inc.sql
\ir platform_funded_gigl_shipping_revoked.cases.inc.sql

ROLLBACK;
