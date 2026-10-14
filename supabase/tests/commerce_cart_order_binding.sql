-- REGRESSION TEST: shared cart checkout preparation and order binding.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h ~/.baci-cart-sock -p 55434 -U postgres \
--     -d cart_bind -f supabase/tests/commerce_cart_order_binding.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- Minimal catalog/merchant stubs exposing exactly the columns the RPCs read.
CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  slug text NOT NULL
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  price numeric(10,2) NOT NULL,
  status text NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  manage_stock boolean NOT NULL DEFAULT true,
  has_variants boolean NOT NULL DEFAULT false
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  price_override numeric(10,2) NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz NULL,
  archived_at timestamptz NULL,
  is_default boolean NOT NULL DEFAULT false
);

-- Minimal orders stub: the binding wrapper replays generations from this
-- table, and the order RPC stubs below record every call for assertions.
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  order_number text NOT NULL,
  tracking_token text NULL,
  total numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid',
  checkout_idempotency_key text NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE public.order_stub_calls (
  seq serial PRIMARY KEY,
  variant text NOT NULL,
  merchant_id uuid NOT NULL,
  idempotency_key text NULL,
  items jsonb NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);
-- Test-controlled stub behavior: fail_with raises from every stub, and
-- next_payment_status overrides the created order's payment status.
CREATE TABLE public.order_stub_behavior (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fail_with text NULL,
  next_payment_status text NULL
);
INSERT INTO public.order_stub_behavior (fail_with, next_payment_status)
VALUES (NULL, NULL);

CREATE OR REPLACE FUNCTION public.stub_maybe_fail() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_fail text;
BEGIN
  SELECT fail_with INTO v_fail FROM public.order_stub_behavior AS b WHERE b.id = 1;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION '%', v_fail;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_storefront_order(
  p_merchant_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_items jsonb,
  p_customer_phone text DEFAULT NULL,
  p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card',
  p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending',
  p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store',
  p_notes text DEFAULT NULL,
  p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL,
  p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0,
  p_expected_total numeric DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL,
  p_checkout_request_hash text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_status text;
BEGIN
  PERFORM public.stub_maybe_fail();
  SELECT coalesce(next_payment_status, p_payment_status)
    INTO v_status FROM public.order_stub_behavior AS b WHERE b.id = 1;
  INSERT INTO public.order_stub_calls (variant, merchant_id, idempotency_key, items)
  VALUES ('base', p_merchant_id, p_checkout_idempotency_key, p_items);
  INSERT INTO public.orders (id, merchant_id, order_number, tracking_token, total, payment_status, checkout_idempotency_key, items)
  VALUES (v_id, p_merchant_id, 'ORD-' || left(v_id::text, 8), 'tok-' || left(v_id::text, 8),
    coalesce(p_expected_total, 0), v_status, p_checkout_idempotency_key, p_items);
  RETURN QUERY SELECT v_id, 'ORD-' || left(v_id::text, 8), 'tok-' || left(v_id::text, 8),
    0::numeric, p_shipping_fee, p_discount_amount, p_tax_amount, coalesce(p_expected_total, 0),
    NULL::uuid, p_customer_email, p_customer_name, p_customer_phone, v_status, p_shipping_status,
    p_payment_method, p_shipping_address, p_merchant_id, p_tax_basis, p_gift_wrapping_fee, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_storefront_order_with_savings(
  p_merchant_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_items jsonb,
  p_customer_phone text DEFAULT NULL,
  p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card',
  p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending',
  p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store',
  p_notes text DEFAULT NULL,
  p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL,
  p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0,
  p_expected_total numeric DEFAULT NULL,
  p_savings_goal_id uuid DEFAULT NULL,
  p_savings_amount numeric DEFAULT NULL,
  p_savings_idempotency_key text DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL,
  p_checkout_request_hash text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric,
  savings_redemption_success boolean, savings_redeemed_amount numeric,
  savings_goal_id uuid, savings_redemption_id uuid, savings_goal_status text,
  idempotency_replayed boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.stub_maybe_fail();
  INSERT INTO public.order_stub_calls (variant, merchant_id, idempotency_key, items, extra)
  VALUES ('savings', p_merchant_id, p_checkout_idempotency_key, p_items,
    jsonb_build_object('savings_goal_id', p_savings_goal_id, 'savings_amount', p_savings_amount));
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_status, checkout_idempotency_key, items)
  VALUES (v_id, p_merchant_id, 'ORD-' || left(v_id::text, 8), coalesce(p_expected_total, 0),
    p_payment_status, p_checkout_idempotency_key, p_items);
  RETURN QUERY SELECT v_id, 'ORD-' || left(v_id::text, 8), 'tok-' || left(v_id::text, 8),
    0::numeric, p_shipping_fee, p_discount_amount, p_tax_amount, coalesce(p_expected_total, 0),
    NULL::uuid, p_customer_email, p_customer_name, p_customer_phone, p_payment_status, p_shipping_status,
    p_payment_method, p_shipping_address, p_merchant_id, p_tax_basis, p_gift_wrapping_fee,
    true, p_savings_amount, p_savings_goal_id, gen_random_uuid(), 'active', false;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_storefront_order_with_quiz_voucher(
  p_merchant_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_items jsonb,
  p_customer_phone text DEFAULT NULL,
  p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card',
  p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending',
  p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store',
  p_notes text DEFAULT NULL,
  p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL,
  p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0,
  p_expected_total numeric DEFAULT NULL,
  p_route_proof jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.stub_maybe_fail();
  INSERT INTO public.order_stub_calls (variant, merchant_id, idempotency_key, items, extra)
  VALUES ('quiz_voucher', p_merchant_id, NULL, p_items,
    jsonb_build_object('route_proof', p_route_proof));
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_status, items)
  VALUES (v_id, p_merchant_id, 'ORD-' || left(v_id::text, 8), coalesce(p_expected_total, 0),
    p_payment_status, p_items);
  RETURN QUERY SELECT v_id, 'ORD-' || left(v_id::text, 8), 'tok-' || left(v_id::text, 8),
    0::numeric, p_shipping_fee, p_discount_amount, p_tax_amount, coalesce(p_expected_total, 0),
    NULL::uuid, p_customer_email, p_customer_name, p_customer_phone, p_payment_status, p_shipping_status,
    p_payment_method, p_shipping_address, p_merchant_id, p_tax_basis, p_gift_wrapping_fee;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_storefront_order_with_discount_code(
  p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb,
  p_customer_phone text DEFAULT NULL, p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card', p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending', p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store', p_notes text DEFAULT NULL, p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL, p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL, p_checkout_request_hash text DEFAULT NULL,
  p_discount_code_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.stub_maybe_fail();
  INSERT INTO public.order_stub_calls (variant, merchant_id, idempotency_key, items, extra)
  VALUES ('discount_code', p_merchant_id, p_checkout_idempotency_key, p_items,
    jsonb_build_object('discount_code_id', p_discount_code_id));
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_status, checkout_idempotency_key, items)
  VALUES (v_id, p_merchant_id, 'ORD-' || left(v_id::text, 8), coalesce(p_expected_total, 0),
    p_payment_status, p_checkout_idempotency_key, p_items);
  RETURN QUERY SELECT v_id, 'ORD-' || left(v_id::text, 8), 'tok-' || left(v_id::text, 8),
    0::numeric, p_shipping_fee, p_discount_amount, p_tax_amount, coalesce(p_expected_total, 0),
    NULL::uuid, p_customer_email, p_customer_name, p_customer_phone, p_payment_status, p_shipping_status,
    p_payment_method, p_shipping_address, p_merchant_id, p_tax_basis, p_gift_wrapping_fee, false;
END;
$$;

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
\ir ../migrations/20261012050200_commerce_cart_commands.sql
\ir ../migrations/20261012050600_commerce_cart_order_binding.sql
\ir ../migrations/20261013195818_commerce_cart_review_binding_guards.sql

INSERT INTO public.merchants (id, slug) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ogabassey'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'second-store');

INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 250.00, 'active', 10, 10, true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 15.00, 'active', 10, 10, true),
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 320.00, 'active', 5, 5, true),
  ('66666666-6666-4666-8666-666666666666', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 9.00, 'active', 10, 10, true);

INSERT INTO public.product_variants (id, product_id, merchant_id, price_override, stock_quantity) VALUES
  ('77777777-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 300.00, 3),
  ('77777777-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', NULL, 2);

-- Cart A1: two lines remain (charger + camera 128GB negotiated); the 256GB
-- line was removed before checkout, so only remaining lines may enter.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'NGN', 3, 'active', now() + interval '7 days'),
  ('aaaaaaaa-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('bbbbbbbb-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('88888888-8888-4888-8888-888888888888', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, variant_id, quantity, negotiated_unit_price_minor, negotiation_status, last_unit_price_minor) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', NULL, 1, NULL, NULL, 25000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', '77777777-0000-4000-8000-000000000001', 2, 28000, 'accepted', 30000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', NULL, 1, NULL, NULL, 1500),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', NULL, 1, NULL, NULL, 25000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', '66666666-6666-4666-8666-666666666666', NULL, 1, NULL, NULL, 900);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-111111111111', 'guest-a2', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999993', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-2222-4222-8222-222222222222', 'guest-a3', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999994', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-stale', now() - interval '1 hour', NULL),
  ('99999999-9999-4999-8999-999999999995', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'guest-foreign', now() + interval '7 days', NULL);

-- 1. Prepare creates a generation-1 session with authoritative lines,
-- validated estimates, and the reviewed version. Only live rows enter.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_session uuid;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-1'
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_result; END IF;
  IF (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'fresh prepare must not replay, got %', v_result; END IF;
  IF (v_result -> 'snapshot' ->> 'generation')::integer <> 1 THEN RAISE EXCEPTION 'first session must be generation 1, got %', v_result; END IF;
  IF (v_result -> 'snapshot' ->> 'cartVersion')::integer <> 3 THEN RAISE EXCEPTION 'snapshot must review version 3, got %', v_result; END IF;
  IF jsonb_array_length(v_result -> 'snapshot' -> 'lines') <> 2 THEN RAISE EXCEPTION 'only the 2 remaining lines may enter, got %', v_result; END IF;
  -- Charger 25000 x1 + negotiated camera 28000 x2 = 81000 minor.
  IF (v_result -> 'snapshot' -> 'estimates' ->> 'subtotalMinor')::integer <> 81000 THEN
    RAISE EXCEPTION 'estimates must use negotiated prices, got %', v_result;
  END IF;
  IF (v_result -> 'snapshot' -> 'estimates' ->> 'currency') <> 'NGN' THEN RAISE EXCEPTION 'estimates must carry currency, got %', v_result; END IF;
  v_session := (v_result -> 'snapshot' ->> 'checkoutSessionId')::uuid;
  IF v_session IS NULL THEN RAISE EXCEPTION 'snapshot must reference the session, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = '22222222-2222-4222-8222-222222222222'
    AND checkout_generation = 1 AND status = 'active'
    AND cart_version_reviewed = 3 AND order_id IS NULL
    AND expires_at > now() + interval '20 minutes';
  IF v_count <> 1 THEN RAISE EXCEPTION 'one active generation-1 session must exist'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222'
    AND state = 'active' AND version = 3 AND checkout_session_id IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart must stay active/editable with the session linked'; END IF;
END
$$;

-- 2. Repeated preparation reuses the session: same id, same generation,
-- still one active row, even under a different operation key.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-1'
  ) INTO v_first;
  IF NOT (v_first ->> 'replayed')::boolean THEN RAISE EXCEPTION 'same op must replay, got %', v_first; END IF;
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-2'
  ) INTO v_second;
  IF (v_second ->> 'replayed')::boolean THEN RAISE EXCEPTION 'new op must not replay, got %', v_second; END IF;
  IF (v_second -> 'snapshot' ->> 'checkoutSessionId') <> (v_first -> 'snapshot' ->> 'checkoutSessionId') THEN
    RAISE EXCEPTION 'repeat prepare must reuse the session, got % vs %', v_first, v_second;
  END IF;
  IF NOT (v_second ->> 'sessionReused')::boolean THEN RAISE EXCEPTION 'reuse must be flagged, got %', v_second; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = '22222222-2222-4222-8222-222222222222' AND status = 'active';
  IF v_count <> 1 THEN RAISE EXCEPTION 'exactly one active session must remain'; END IF;
END
$$;

-- 3. Same operation key with a different body is a conflict, not a reuse.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 2, 'prep-op-1'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'key/body mismatch must conflict, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 4. A stale expected version requires refresh and creates nothing.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 2, 'prep-op-stale'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'refresh_required' THEN
    RAISE EXCEPTION 'stale version must require refresh, got %', v_result;
  END IF;
  IF (v_result ->> 'currentVersion')::integer <> 3 THEN RAISE EXCEPTION 'stale result must carry the live version, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = '22222222-2222-4222-8222-222222222222' AND checkout_generation > 1;
  IF v_count <> 0 THEN RAISE EXCEPTION 'stale prepare must not mint a session'; END IF;
END
$$;

-- 5. Changed prices and availability are shown, not hidden: the merchant
-- repriced the charger and the camera stock ran out after review data
-- was cached. Prepare still succeeds and flags both lines.
UPDATE public.products SET price = 275.00 WHERE id = '33333333-3333-4333-8333-333333333333';
UPDATE public.product_variants SET stock_quantity = 1 WHERE id = '77777777-0000-4000-8000-000000000001';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_charger jsonb;
  v_camera jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-price'
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed despite changes, got %', v_result; END IF;
  SELECT line INTO v_charger FROM jsonb_array_elements(v_result -> 'snapshot' -> 'lines') AS line
  WHERE line ->> 'productId' = '33333333-3333-4333-8333-333333333333';
  SELECT line INTO v_camera FROM jsonb_array_elements(v_result -> 'snapshot' -> 'lines') AS line
  WHERE line ->> 'productId' = '55555555-5555-4555-8555-555555555555';
  IF (v_charger ->> 'validatedUnitPriceMinor')::integer <> 27500 THEN RAISE EXCEPTION 'charger must show the new price, got %', v_result; END IF;
  IF NOT (v_charger ->> 'priceChanged')::boolean THEN RAISE EXCEPTION 'charger reprice must be flagged, got %', v_result; END IF;
  IF (v_charger ->> 'available')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'charger must stay available, got %', v_result; END IF;
  IF (v_camera ->> 'available')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'short-stock camera must flag unavailable, got %', v_result; END IF;
  IF (v_camera ->> 'unavailableReason') IS NULL THEN RAISE EXCEPTION 'unavailable line needs a reason, got %', v_result; END IF;
END
$$;
RESET ROLE;
-- Restore catalog for later sections.
UPDATE public.products SET price = 250.00 WHERE id = '33333333-3333-4333-8333-333333333333';
UPDATE public.product_variants SET stock_quantity = 3 WHERE id = '77777777-0000-4000-8000-000000000001';

-- 6. Auth boundaries: expired grants, unknown carts, and missing claims fail
-- without minting sessions.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-stale","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999994"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-expired'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'expired' THEN
    RAISE EXCEPTION 'expired grant must fail closed, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '22222222-2222-4222-8222-222222222222', 3, 'prep-op-anon'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'missing claims must fail closed, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a1","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    '99999999-9999-4999-8999-999999999999', 1, 'prep-op-missing'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'claim/cart mismatch must fail closed, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- Additional single-line carts for submit-path sections.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('cccccccc-4000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-5000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-6000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-7000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-8000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-9000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-a000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-b000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-c000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('dddddddd-4000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-4000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-5000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-5000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-6000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-6000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-7000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-7000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-8000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-8000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-9000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-9000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-a000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-a000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-b000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-b000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-c000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-c000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999960', '11111111-1111-4111-8111-111111111111', 'cccccccc-4000-4000-8000-000000000000', 'guest-a4', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999961', '11111111-1111-4111-8111-111111111111', 'cccccccc-5000-4000-8000-000000000000', 'guest-a5', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999962', '11111111-1111-4111-8111-111111111111', 'cccccccc-6000-4000-8000-000000000000', 'guest-a6', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999963', '11111111-1111-4111-8111-111111111111', 'cccccccc-7000-4000-8000-000000000000', 'guest-a7', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999964', '11111111-1111-4111-8111-111111111111', 'cccccccc-8000-4000-8000-000000000000', 'guest-a8', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999965', '11111111-1111-4111-8111-111111111111', 'cccccccc-9000-4000-8000-000000000000', 'guest-a9', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999966', '11111111-1111-4111-8111-111111111111', 'cccccccc-a000-4000-8000-000000000000', 'guest-a10', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999967', '11111111-1111-4111-8111-111111111111', 'cccccccc-b000-4000-8000-000000000000', 'guest-a11', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999968', '11111111-1111-4111-8111-111111111111', 'cccccccc-c000-4000-8000-000000000000', 'guest-a12', now() + interval '7 days', NULL);

CREATE TEMP TABLE test_ctx (key text PRIMARY KEY, value text);
GRANT ALL ON test_ctx TO anon, authenticated, service_role, commerce_cart_shopper;

-- 7. Bound submission creates exactly one order, stamps the session, and
-- closes the cart generation atomically. Order items carry cart line ids.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a2","cart_scope":"session","cart_id":"aaaaaaaa-1111-4111-8111-111111111111","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'aaaaaaaa-1111-4111-8111-111111111111', 1, 'prep-op-a2'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a2_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a2_session';
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    v_session,
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00,
        'cart_line_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'
      )),
      'p_expected_total', 15.00,
      'p_cart_principal_id', 'guest-a2',
      'p_checkout_idempotency_key', 'order-key-a2',
      'p_checkout_request_hash', 'hash-a2'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'bound submit must succeed, got %', v_result; END IF;
  IF (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'fresh submit must not replay, got %', v_result; END IF;
  v_order_id := (v_result -> 'order' ->> 'id')::uuid;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'result must carry the order, got %', v_result; END IF;
  IF (v_result -> 'binding' ->> 'checkout_generation')::integer <> 1 THEN RAISE EXCEPTION 'result must carry the binding receipt, got %', v_result; END IF;
  -- The receipt order mirrors the inner row so continuations read it
  -- like a direct RPC row.
  IF v_result -> 'order' ->> 'order_number' IS NULL THEN RAISE EXCEPTION 'receipt must carry the order number, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'total')::numeric <> 15.00 THEN RAISE EXCEPTION 'receipt must carry the total, got %', v_result; END IF;
  IF v_result -> 'order' ->> 'payment_status' <> 'unpaid' THEN RAISE EXCEPTION 'receipt must carry payment status, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'idempotency_replayed')::boolean THEN RAISE EXCEPTION 'fresh receipt must not flag replay, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_orders integer;
  v_calls integer;
BEGIN
  SELECT count(*) INTO v_orders FROM public.orders WHERE checkout_idempotency_key = 'order-key-a2';
  IF v_orders <> 1 THEN RAISE EXCEPTION 'exactly one order must exist'; END IF;
  SELECT count(*) INTO v_calls FROM public.order_stub_calls WHERE variant = 'base' AND idempotency_key = 'order-key-a2';
  IF v_calls <> 1 THEN RAISE EXCEPTION 'inner base RPC must run exactly once'; END IF;
  SELECT count(*) INTO v_orders FROM public.commerce_cart_checkout_sessions s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.cart_id = 'aaaaaaaa-1111-4111-8111-111111111111'
    AND s.status = 'submitted' AND o.checkout_idempotency_key = 'order-key-a2';
  IF v_orders <> 1 THEN RAISE EXCEPTION 'session must be submitted and linked to the order'; END IF;
  SELECT count(*) INTO v_orders FROM public.commerce_carts
  WHERE id = 'aaaaaaaa-1111-4111-8111-111111111111' AND state = 'completed';
  IF v_orders <> 1 THEN RAISE EXCEPTION 'cart generation must close atomically with the order'; END IF;
  SELECT count(*) INTO v_orders FROM public.orders
  WHERE checkout_idempotency_key = 'order-key-a2'
    AND items @> jsonb_build_array(jsonb_build_object(
      'cart_line_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'));
  IF v_orders <> 1 THEN RAISE EXCEPTION 'order items must carry cart line ids'; END IF;
END
$$;

-- 8. Two different order idempotency keys for one generation replay the
-- same order: the inner RPC never runs a second time.
INSERT INTO test_ctx (key, value)
SELECT 'a2_order', order_id::text FROM public.commerce_cart_checkout_sessions
WHERE cart_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND checkout_generation = 1;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_first uuid;
  v_result jsonb;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a2_session';
  SELECT value::uuid INTO v_first FROM test_ctx WHERE key = 'a2_order';
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    v_session,
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00,
        'cart_line_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'
      )),
      'p_expected_total', 15.00,
      'p_cart_principal_id', 'guest-a2',
      'p_checkout_idempotency_key', 'order-key-a2-second',
      'p_checkout_request_hash', 'hash-a2-second'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'generation replay must succeed, got %', v_result; END IF;
  IF NOT (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'second key must replay, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'id')::uuid <> v_first THEN RAISE EXCEPTION 'replay must return the same order, got %', v_result; END IF;
  IF NOT (v_result -> 'order' ->> 'idempotency_replayed')::boolean THEN
    RAISE EXCEPTION 'replay must flag the order replayed, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_calls integer;
BEGIN
  SELECT count(*) INTO v_calls FROM public.order_stub_calls WHERE variant = 'base';
  IF v_calls <> 1 THEN RAISE EXCEPTION 'inner RPC must not rerun for the generation replay'; END IF;
END
$$;

-- 9. A cart edit after review makes the binding stale: the submit fails
-- before any order side effect, and the session stays usable after refresh.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a7","cart_scope":"session","cart_id":"cccccccc-7000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999963"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-7000-4000-8000-000000000000', 1, 'prep-op-a7'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a7_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
-- Another device removes the line: version moves under the review.
DELETE FROM public.commerce_cart_lines WHERE cart_id = 'cccccccc-7000-4000-8000-000000000000';
UPDATE public.commerce_carts SET version = 2 WHERE id = 'cccccccc-7000-4000-8000-000000000000';
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a7_session';
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      v_session,
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', jsonb_build_array(jsonb_build_object(
          'product_id', '44444444-4444-4444-8444-444444444444',
          'quantity', 1,
          'price', 15.00
        )),
        'p_expected_total', 15.00,
        'p_cart_principal_id', 'guest-a7',
        'p_checkout_idempotency_key', 'order-key-a7',
        'p_checkout_request_hash', 'hash-a7'
      )
    );
    RAISE EXCEPTION 'stale submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.order_stub_calls WHERE idempotency_key = 'order-key-a7';
  IF v_count <> 0 THEN RAISE EXCEPTION 'stale submit must not reach the order RPC'; END IF;
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a7';
  IF v_count <> 0 THEN RAISE EXCEPTION 'stale submit must not create an order'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = 'cccccccc-7000-4000-8000-000000000000' AND status = 'active';
  IF v_count <> 1 THEN RAISE EXCEPTION 'failed submit must leave the session active'; END IF;
END
$$;

-- 10. Quiz-voucher variant routes through the voucher inner RPC, which
-- takes a route proof instead of checkout idempotency keys.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a4","cart_scope":"session","cart_id":"cccccccc-4000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999960"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-4000-4000-8000-000000000000', 1, 'prep-op-a4'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a4_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_result jsonb;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a4_session';
  SELECT public.create_storefront_order_with_cart_binding(
    'quiz_voucher',
    v_session,
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-4000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_cart_principal_id', 'guest-a4',
      'p_route_proof', jsonb_build_object('attempt', 'quiz-proof-a4')
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'voucher submit must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.order_stub_calls
  WHERE variant = 'quiz_voucher' AND extra -> 'route_proof' ->> 'attempt' = 'quiz-proof-a4';
  IF v_count <> 1 THEN RAISE EXCEPTION 'route proof must reach the voucher RPC'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-4000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'voucher submit must close the cart'; END IF;
END
$$;

-- 11. Savings variant forwards the redemption fields to the savings RPC.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a5","cart_scope":"session","cart_id":"cccccccc-5000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999961"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-5000-4000-8000-000000000000', 1, 'prep-op-a5'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a5_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_result jsonb;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a5_session';
  SELECT public.create_storefront_order_with_cart_binding(
    'savings',
    v_session,
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-5000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_savings_goal_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',
      'p_savings_amount', 5.00,
      'p_cart_principal_id', 'guest-a5',
      'p_savings_idempotency_key', 'save-key-a5',
      'p_checkout_idempotency_key', 'order-key-a5',
      'p_checkout_request_hash', 'hash-a5'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'savings submit must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.order_stub_calls
  WHERE variant = 'savings' AND idempotency_key = 'order-key-a5'
    AND extra ->> 'savings_goal_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099';
  IF v_count <> 1 THEN RAISE EXCEPTION 'savings fields must reach the savings RPC'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-5000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'savings submit must close the cart'; END IF;
END
$$;

-- 12. Discount-code variant forwards the code id to the discount RPC.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a6","cart_scope":"session","cart_id":"cccccccc-6000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999962"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-6000-4000-8000-000000000000', 1, 'prep-op-a6'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a6_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_result jsonb;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a6_session';
  SELECT public.create_storefront_order_with_cart_binding(
    'discount_code',
    v_session,
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-6000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_discount_code_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000098',
      'p_cart_principal_id', 'guest-a6',
      'p_checkout_idempotency_key', 'order-key-a6',
      'p_checkout_request_hash', 'hash-a6'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'discount submit must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.order_stub_calls
  WHERE variant = 'discount_code' AND idempotency_key = 'order-key-a6'
    AND extra ->> 'discount_code_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000098';
  IF v_count <> 1 THEN RAISE EXCEPTION 'code id must reach the discount RPC'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-6000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'discount submit must close the cart'; END IF;
END
$$;

-- 13. Cross-merchant submit is rejected before any order side effect.
-- Claims target merchant B while the session belongs to merchant A.
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"22222222-2222-4222-8222-222222222222"}';
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (SELECT value::uuid FROM test_ctx WHERE key = 'a7_session'),
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', '[]'::jsonb,
        'p_expected_total', 15.00,
        'p_checkout_idempotency_key', 'order-key-a13',
        'p_checkout_request_hash', 'hash-a13'
      )
    );
    RAISE EXCEPTION 'cross-merchant submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_order_merchant_mismatch' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
-- The rejected attempt must not have consumed the session or cart.
DO $$
DECLARE
  v_used boolean;
  v_state text;
BEGIN
  SELECT submitted_at IS NOT NULL INTO v_used
  FROM public.commerce_cart_checkout_sessions
  WHERE id = (SELECT value::uuid FROM test_ctx WHERE key = 'a7_session');
  IF v_used THEN RAISE EXCEPTION 'rejected submit must not stamp the session'; END IF;
  SELECT state INTO v_state FROM public.commerce_carts WHERE id = 'cccccccc-7000-4000-8000-000000000000';
  IF v_state <> 'active' THEN RAISE EXCEPTION 'rejected submit must leave cart active, got %', v_state; END IF;
END
$$;

-- 14. Submit without an order context is rejected as unauthorized.
RESET request.jwt.claims;
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (SELECT value::uuid FROM test_ctx WHERE key = 'a7_session'),
      1,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'contextless submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;

-- 15. An expired session can no longer submit, even unchanged.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a9","cart_scope":"session","cart_id":"cccccccc-9000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999965"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-9000-4000-8000-000000000000', 1, 'prep-op-a9'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a9_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
UPDATE public.commerce_cart_checkout_sessions
  SET expires_at = now() - interval '1 second'
  WHERE id = (SELECT value::uuid FROM test_ctx WHERE key = 'a9_session');
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a9_session';
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      v_session,
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', '[]'::jsonb,
        'p_expected_total', 15.00,
        'p_cart_principal_id', 'guest-a9',
        'p_checkout_idempotency_key', 'order-key-a9',
        'p_checkout_request_hash', 'hash-a9'
      )
    );
    RAISE EXCEPTION 'expired submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_checkout_expired' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;

-- The shopper adds a remaining item before refreshing; empty carts cannot order.
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
VALUES ('dddddddd-7001-4000-8000-000000000000','11111111-1111-4111-8111-111111111111','cccccccc-7000-4000-8000-000000000000','44444444-4444-4444-8444-444444444444',1,1500);
-- 16. Refresh after a cart edit mints generation 2; the new session
-- submits cleanly while the older generation goes stale.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a7","cart_scope":"session","cart_id":"cccccccc-7000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999963"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
  v_old uuid;
BEGIN
  SELECT value::uuid INTO v_old FROM test_ctx WHERE key = 'a7_session';
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-7000-4000-8000-000000000000', 2, 'prep-op-a7-refresh'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'refresh prepare must succeed, got %', v_prep; END IF;
  IF (v_prep -> 'snapshot' ->> 'generation')::integer <> 2 THEN
    RAISE EXCEPTION 'refresh must mint generation 2, got %', v_prep;
  END IF;
  IF (v_prep ->> 'sessionReused')::boolean THEN RAISE EXCEPTION 'new version must not reuse, got %', v_prep; END IF;
  IF (v_prep -> 'snapshot' ->> 'checkoutSessionId')::uuid = v_old THEN
    RAISE EXCEPTION 'generation 2 needs its own session, got %', v_prep;
  END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a7_gen2_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_session uuid;
  v_result jsonb;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a7_gen2_session';
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    v_session,
    2,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object('cart_line_id','dddddddd-7001-4000-8000-000000000000','product_id','44444444-4444-4444-8444-444444444444','quantity',1,'price',15)),
      'p_expected_total', 0,
      'p_cart_principal_id', 'guest-a7',
      'p_checkout_idempotency_key', 'order-key-a7-gen2',
      'p_checkout_request_hash', 'hash-a7-gen2'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'gen-2 submit must succeed, got %', v_result; END IF;
  -- The older generation now submits stale: the cart is completed.
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (SELECT value::uuid FROM test_ctx WHERE key = 'a7_session'),
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', '[]'::jsonb,
        'p_expected_total', 0,
        'p_cart_principal_id', 'guest-a7',
        'p_checkout_idempotency_key', 'order-key-a7-late',
        'p_checkout_request_hash', 'hash-a7-late'
      )
    );
    RAISE EXCEPTION 'old-generation submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-7000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'gen-2 submit must close the cart'; END IF;
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a7-late';
  IF v_count <> 0 THEN RAISE EXCEPTION 'stale old-generation submit must not order'; END IF;
END
$$;

-- 17. The broad service_role key is not a binding caller: only the
-- scoped storefront-route and agentic checkout contexts may submit.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a10","cart_scope":"session","cart_id":"cccccccc-a000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999966"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-a000-4000-8000-000000000000', 1, 'prep-op-a10'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a10_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
DO $$
DECLARE
  v_session uuid;
  rejected boolean := false;
BEGIN
  SELECT value::uuid INTO v_session FROM test_ctx WHERE key = 'a10_session';
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      v_session,
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', jsonb_build_array(jsonb_build_object(
          'cart_line_id', 'dddddddd-a000-4000-8000-000000000000',
          'product_id', '44444444-4444-4444-8444-444444444444',
          'quantity', 1,
          'price', 15.00
        )),
        'p_expected_total', 15.00,
        'p_checkout_idempotency_key', 'order-key-a10',
        'p_checkout_request_hash', 'hash-a10'
      )
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF;
    rejected := true;
  WHEN insufficient_privilege THEN
    -- No EXECUTE grant: the key cannot even invoke the binding.
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'service_role submit must be rejected'; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a10';
  IF v_count <> 0 THEN RAISE EXCEPTION 'service submit must not create an order'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-a000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 0 THEN RAISE EXCEPTION 'service submit must not close the cart'; END IF;
END
$$;

-- 18. Closing semantics: a completed cart cannot reopen its generation,
-- ordinary cart tokens cannot submit, pending-payment orders still close
-- the generation, and inner failures roll everything back.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a2","cart_scope":"session","cart_id":"aaaaaaaa-1111-4111-8111-111111111111","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'aaaaaaaa-1111-4111-8111-111111111111', 1, 'prep-op-a2-reopen'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'refresh_required' THEN
    RAISE EXCEPTION 'completed cart must not reopen, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a11","cart_scope":"session","cart_id":"cccccccc-b000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999967"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-b000-4000-8000-000000000000', 1, 'prep-op-a11'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a11_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
  -- An ordinary cart token cannot even call the binding: no EXECUTE grant.
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (v_prep -> 'snapshot' ->> 'checkoutSessionId')::uuid,
      1,
      jsonb_build_object('p_merchant_id', '11111111-1111-4111-8111-111111111111')
    );
    RAISE EXCEPTION 'cart-token submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
-- A pending-payment order still closes its generation atomically.
UPDATE public.order_stub_behavior SET next_payment_status = 'pending' WHERE id = 1;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    (SELECT value::uuid FROM test_ctx WHERE key = 'a11_session'),
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-b000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_payment_status', 'pending',
      'p_cart_principal_id', 'guest-a11',
      'p_checkout_idempotency_key', 'order-key-a11',
      'p_checkout_request_hash', 'hash-a11'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'pending submit must succeed, got %', v_result; END IF;
  IF v_result -> 'order' ->> 'payment_status' <> 'pending' THEN
    RAISE EXCEPTION 'receipt must carry pending status, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
UPDATE public.order_stub_behavior SET next_payment_status = NULL WHERE id = 1;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders
  WHERE checkout_idempotency_key = 'order-key-a11' AND payment_status = 'pending';
  IF v_count <> 1 THEN RAISE EXCEPTION 'pending order must persist'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-b000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'pending order must close the cart'; END IF;
END
$$;
-- An inner order failure rolls the binding back: session stays active,
-- cart stays open, no order and no inner side effect persist.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a12","cart_scope":"session","cart_id":"cccccccc-c000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999968"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-c000-4000-8000-000000000000', 1, 'prep-op-a12'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a12_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
UPDATE public.order_stub_behavior SET fail_with = 'order_total_mismatch' WHERE id = 1;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (SELECT value::uuid FROM test_ctx WHERE key = 'a12_session'),
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', jsonb_build_array(jsonb_build_object('cart_line_id','dddddddd-c000-4000-8000-000000000000','product_id','44444444-4444-4444-8444-444444444444','quantity',1,'price',15)),
        'p_expected_total', 0,
        'p_cart_principal_id', 'guest-a12',
        'p_checkout_idempotency_key', 'order-key-a12',
        'p_checkout_request_hash', 'hash-a12'
      )
    );
    RAISE EXCEPTION 'failing submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_total_mismatch' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
UPDATE public.order_stub_behavior SET fail_with = NULL WHERE id = 1;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE id = (SELECT value::uuid FROM test_ctx WHERE key = 'a12_session')
    AND status = 'active' AND order_id IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'failed submit must leave the session usable'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-c000-4000-8000-000000000000' AND state = 'active';
  IF v_count <> 1 THEN RAISE EXCEPTION 'failed submit must leave the cart open'; END IF;
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a12';
  IF v_count <> 0 THEN RAISE EXCEPTION 'failed submit must not create an order'; END IF;
  SELECT count(*) INTO v_count FROM public.order_stub_calls WHERE idempotency_key = 'order-key-a12';
  IF v_count <> 0 THEN RAISE EXCEPTION 'failed submit must not reach the inner RPC'; END IF;
END
$$;

-- 19. The server-minted agentic checkout context submits when its
-- merchant agrees, and fails closed on cross-merchant use.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('cccccccc-d000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-e000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('dddddddd-d000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-d000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-e000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999969', '11111111-1111-4111-8111-111111111111', 'cccccccc-d000-4000-8000-000000000000', 'guest-a13', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-99999999996a', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', 'guest-a14', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a13","cart_scope":"session","cart_id":"cccccccc-d000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999969"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-d000-4000-8000-000000000000', 1, 'prep-op-a13'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a13_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","agentic_context":"checkout","agentic_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    (SELECT value::uuid FROM test_ctx WHERE key = 'a13_session'),
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-d000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_cart_principal_id', 'guest-a13',
      'p_checkout_idempotency_key', 'order-key-a13',
      'p_checkout_request_hash', 'hash-a13'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'agentic submit must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a13';
  IF v_count <> 1 THEN RAISE EXCEPTION 'agentic submit must create the order'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-d000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'agentic submit must close the cart'; END IF;
END
$$;
-- Cross-merchant agentic use fails before any order side effect.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a14","cart_scope":"session","cart_id":"cccccccc-e000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-99999999996a"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-e000-4000-8000-000000000000', 1, 'prep-op-a14'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a14_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","agentic_context":"checkout","agentic_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding(
      'base',
      (SELECT value::uuid FROM test_ctx WHERE key = 'a14_session'),
      1,
      jsonb_build_object(
        'p_merchant_id', '11111111-1111-4111-8111-111111111111',
        'p_customer_email', 'buyer@example.com',
        'p_customer_name', 'Buyer',
        'p_items', '[]'::jsonb,
        'p_expected_total', 15.00,
        'p_checkout_idempotency_key', 'order-key-a14',
        'p_checkout_request_hash', 'hash-a14'
      )
    );
    RAISE EXCEPTION 'cross-merchant agentic submit must raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cart_order_merchant_mismatch' THEN RAISE; END IF;
  END;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a14';
  IF v_count <> 0 THEN RAISE EXCEPTION 'rejected agentic submit must not order'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-e000-4000-8000-000000000000' AND state = 'active';
  IF v_count <> 1 THEN RAISE EXCEPTION 'rejected agentic submit must leave the cart open'; END IF;
END
$$;

-- 20. The bound receipt preserves variant-specific inner columns: a
-- savings submit carries the redemption fields so continuations read
-- the bound row like a direct RPC row.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('cccccccc-f000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('dddddddd-f000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-99999999996b', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'guest-a15', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a15","cart_scope":"session","cart_id":"cccccccc-f000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-99999999996b"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_prep jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-f000-4000-8000-000000000000', 1, 'prep-op-a15'
  ) INTO v_prep;
  IF NOT (v_prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', v_prep; END IF;
  INSERT INTO test_ctx (key, value) VALUES ('a15_session', v_prep -> 'snapshot' ->> 'checkoutSessionId');
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.create_storefront_order_with_cart_binding(
    'savings',
    (SELECT value::uuid FROM test_ctx WHERE key = 'a15_session'),
    1,
    jsonb_build_object(
      'p_merchant_id', '11111111-1111-4111-8111-111111111111',
      'p_customer_email', 'buyer@example.com',
      'p_customer_name', 'Buyer',
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', 'dddddddd-f000-4000-8000-000000000000',
        'product_id', '44444444-4444-4444-8444-444444444444',
        'quantity', 1,
        'price', 15.00
      )),
      'p_expected_total', 15.00,
      'p_savings_goal_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010',
      'p_savings_amount', 5.00,
      'p_cart_principal_id', 'guest-a15',
      'p_savings_idempotency_key', 'save-key-a15',
      'p_checkout_idempotency_key', 'order-key-a15',
      'p_checkout_request_hash', 'hash-a15'
    )
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'savings submit must succeed, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'savings_redemption_success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'receipt must carry savings success, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'savings_redeemed_amount')::numeric <> 5.00 THEN RAISE EXCEPTION 'receipt must carry redeemed amount, got %', v_result; END IF;
  IF v_result -> 'order' ->> 'savings_goal_id' <> 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010' THEN RAISE EXCEPTION 'receipt must carry savings goal, got %', v_result; END IF;
  IF v_result -> 'order' ->> 'savings_redemption_id' IS NULL THEN RAISE EXCEPTION 'receipt must carry redemption id, got %', v_result; END IF;
  IF v_result -> 'order' ->> 'savings_goal_status' <> 'active' THEN RAISE EXCEPTION 'receipt must carry goal status, got %', v_result; END IF;
  IF (v_result -> 'order' ->> 'idempotency_replayed')::boolean THEN RAISE EXCEPTION 'fresh savings receipt must not flag replay, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-a15';
  IF v_count <> 1 THEN RAISE EXCEPTION 'savings submit must create the order'; END IF;
  SELECT count(*) INTO v_count FROM public.order_stub_calls WHERE variant = 'savings' AND idempotency_key = 'order-key-a15';
  IF v_count <> 1 THEN RAISE EXCEPTION 'inner savings RPC must run exactly once'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_carts
  WHERE id = 'cccccccc-f000-4000-8000-000000000000' AND state = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'savings submit must close the cart'; END IF;
END
$$;

ROLLBACK;
