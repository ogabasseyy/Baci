-- RACE TEST: concurrent submits collapse into one order, concurrent
-- prepares collapse into one session.
--
-- Run only against an empty disposable PostgreSQL database (never
-- production). Database for this file: cart_bind_race.
--
--   export PG="psql -X -v ON_ERROR_STOP=1 -h ~/.baci-cart-sock -p 55434 -U postgres -d cart_bind_race"
--   export F=supabase/tests/commerce_cart_order_binding_race.sql
--   $PG -v DO_SETUP=1 -f $F
--   python3 ~/.baci-cart-race/binding-runner.py submit
--   python3 ~/.baci-cart-race/binding-runner.py prep
--   python3 ~/.baci-cart-race/binding-runner.py prep-sameop
--   $PG -v DO_CHECK=1 -f $F
--
-- Submit race: session A submits and holds its transaction open for 6
-- seconds; session B starts ~1s later with a different order key, waits
-- on the session lock, then replays A's receipt: exactly one inner order
-- call, both callers ok, same order id.
--
-- Prepare race: PA prepares and holds its transaction open; PB starts ~1s
-- later with a different operation key, waits on the cart lock, then
-- reuses PA's session: exactly one session row.
--
-- Same-op prepare race: PI and PBI prepare under one operation key; the
-- loser blocks on the key lock, then replays the winner's snapshot
-- instead of minting a second session.

\set ON_ERROR_STOP on

\if :{?DO_SETUP}
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
CREATE TABLE IF NOT EXISTS public.merchants (id uuid PRIMARY KEY, slug text NOT NULL);
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, price numeric(10,2) NOT NULL,
  status text NOT NULL, stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0, manage_stock boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY, product_id uuid NOT NULL, merchant_id uuid NOT NULL,
  price_override numeric(10,2) NULL, stock_quantity integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  order_number text NOT NULL,
  total numeric NOT NULL DEFAULT 0,
  checkout_idempotency_key text NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS public.order_stub_calls (
  seq serial PRIMARY KEY,
  variant text NOT NULL,
  merchant_id uuid NOT NULL,
  idempotency_key text NULL,
  items jsonb NOT NULL
);
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
BEGIN
  INSERT INTO public.order_stub_calls (variant, merchant_id, idempotency_key, items)
  VALUES ('base', p_merchant_id, p_checkout_idempotency_key, p_items);
  INSERT INTO public.orders (id, merchant_id, order_number, total, checkout_idempotency_key, items)
  VALUES (v_id, p_merchant_id, 'ORD-' || left(v_id::text, 8), coalesce(p_expected_total, 0),
    p_checkout_idempotency_key, p_items);
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
CREATE TABLE IF NOT EXISTS public.binding_race_results (
  session text PRIMARY KEY,
  ok boolean NOT NULL,
  replayed boolean NULL,
  reused boolean NULL,
  ref_id text NULL
);
GRANT INSERT, SELECT, UPDATE ON public.binding_race_results TO authenticated, commerce_cart_shopper;
CREATE TABLE IF NOT EXISTS public.binding_race_ctx (
  key text PRIMARY KEY,
  value text NOT NULL
);
GRANT SELECT ON public.binding_race_ctx TO authenticated, commerce_cart_shopper;
DELETE FROM public.binding_race_results;
DELETE FROM public.binding_race_ctx;
DELETE FROM public.order_stub_calls;
DELETE FROM public.orders;
INSERT INTO public.merchants (id, slug) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ogabassey')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 15.00, 'active', 10, 10, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('cccccccc-d000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-e000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('cccccccc-f000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.commerce_cart_lines
WHERE cart_id IN ('cccccccc-d000-4000-8000-000000000000', 'cccccccc-e000-4000-8000-000000000000', 'cccccccc-f000-4000-8000-000000000000');
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('dddddddd-d000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-d000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-e000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('dddddddd-f000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999970', '11111111-1111-4111-8111-111111111111', 'cccccccc-d000-4000-8000-000000000000', 'race-sub', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999971', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', 'race-pa', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999972', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', 'race-pb', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999973', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'race-pi', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999974', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'race-pbi', now() + interval '7 days', NULL)
ON CONFLICT (id) DO NOTHING;
-- The submit race needs one prepared session; racers read its id from ctx.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"race-sub","cart_scope":"session","cart_id":"cccccccc-d000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999970"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-d000-4000-8000-000000000000', 1, 'prep-op-race-sub'
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'race setup prepare must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
INSERT INTO public.binding_race_ctx (key, value)
SELECT 'sub_session', id::text FROM public.commerce_cart_checkout_sessions
WHERE cart_id = 'cccccccc-d000-4000-8000-000000000000' AND checkout_generation = 1;
\endif

\if :{?DO_SUB_A}
BEGIN;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    (SELECT value::uuid FROM public.binding_race_ctx WHERE key = 'sub_session'),
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
      'p_cart_principal_id', 'race-sub',
      'p_checkout_idempotency_key', 'order-key-race-a',
      'p_checkout_request_hash', 'hash-race-a'
    )
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, ref_id)
  VALUES ('sub_a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean, v_result -> 'order' ->> 'id')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed, ref_id = EXCLUDED.ref_id;
END
$$;
SELECT pg_sleep(6);
COMMIT;
\endif

\if :{?DO_SUB_B}
BEGIN;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.create_storefront_order_with_cart_binding(
    'base',
    (SELECT value::uuid FROM public.binding_race_ctx WHERE key = 'sub_session'),
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
      'p_cart_principal_id', 'race-sub',
      'p_checkout_idempotency_key', 'order-key-race-b',
      'p_checkout_request_hash', 'hash-race-b'
    )
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, ref_id)
  VALUES ('sub_b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean, v_result -> 'order' ->> 'id')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed, ref_id = EXCLUDED.ref_id;
END
$$;
COMMIT;
\endif

\if :{?DO_PREP_A}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"race-pa","cart_scope":"session","cart_id":"cccccccc-e000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999971"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-e000-4000-8000-000000000000', 1, 'prep-op-race-pa'
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, reused, ref_id)
  VALUES ('prep_a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    (v_result ->> 'sessionReused')::boolean, v_result -> 'snapshot' ->> 'checkoutSessionId')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed,
    reused = EXCLUDED.reused, ref_id = EXCLUDED.ref_id;
END
$$;
SELECT pg_sleep(6);
COMMIT;
\endif

\if :{?DO_PREP_B}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"race-pb","cart_scope":"session","cart_id":"cccccccc-e000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999972"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-e000-4000-8000-000000000000', 1, 'prep-op-race-pb'
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, reused, ref_id)
  VALUES ('prep_b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    (v_result ->> 'sessionReused')::boolean, v_result -> 'snapshot' ->> 'checkoutSessionId')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed,
    reused = EXCLUDED.reused, ref_id = EXCLUDED.ref_id;
END
$$;
COMMIT;
\endif

\if :{?DO_SAME_A}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"race-pi","cart_scope":"session","cart_id":"cccccccc-f000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999973"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-f000-4000-8000-000000000000', 1, 'prep-op-race-shared'
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, reused, ref_id)
  VALUES ('same_a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    (v_result ->> 'sessionReused')::boolean, v_result -> 'snapshot' ->> 'checkoutSessionId')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed,
    reused = EXCLUDED.reused, ref_id = EXCLUDED.ref_id;
END
$$;
SELECT pg_sleep(6);
COMMIT;
\endif

\if :{?DO_SAME_B}
BEGIN;
-- Identical claims to session A: a double-click retry. B blocks on the
-- operation-key lock, then replays A's receipt instead of minting again.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"race-pi","cart_scope":"session","cart_id":"cccccccc-f000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999973"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_prepare_checkout(
    'cccccccc-f000-4000-8000-000000000000', 1, 'prep-op-race-shared'
  ) INTO v_result;
  INSERT INTO public.binding_race_results (session, ok, replayed, reused, ref_id)
  VALUES ('same_b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    (v_result ->> 'sessionReused')::boolean, v_result -> 'snapshot' ->> 'checkoutSessionId')
  ON CONFLICT (session) DO UPDATE SET ok = EXCLUDED.ok, replayed = EXCLUDED.replayed,
    reused = EXCLUDED.reused, ref_id = EXCLUDED.ref_id;
END
$$;
COMMIT;
\endif

\if :{?DO_CHECK}
DO $$
DECLARE
  r record;
  v_count integer;
BEGIN
  SELECT * INTO r FROM public.binding_race_results WHERE session = 'sub_a';
  IF NOT FOUND OR NOT r.ok OR r.replayed THEN RAISE EXCEPTION 'submit A must win fresh, got %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.binding_race_results WHERE session = 'sub_b';
  IF NOT FOUND OR NOT r.ok OR NOT r.replayed THEN RAISE EXCEPTION 'submit B must replay, got %', row_to_json(r); END IF;
  SELECT count(*) INTO v_count FROM public.binding_race_results WHERE session IN ('sub_a', 'sub_b');
  IF v_count <> 2 THEN RAISE EXCEPTION 'both submit racers must report'; END IF;
  PERFORM 1 FROM public.binding_race_results a JOIN public.binding_race_results b
    ON a.session = 'sub_a' AND b.session = 'sub_b' AND a.ref_id = b.ref_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'submit replay must return the same order'; END IF;
  SELECT count(*) INTO v_count FROM public.order_stub_calls WHERE variant = 'base';
  IF v_count <> 1 THEN RAISE EXCEPTION 'inner order RPC must run exactly once, ran %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.orders;
  IF v_count <> 1 THEN RAISE EXCEPTION 'exactly one order must exist, found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.orders WHERE checkout_idempotency_key = 'order-key-race-b';
  IF v_count <> 0 THEN RAISE EXCEPTION 'loser key must never reach the order table'; END IF;

  SELECT * INTO r FROM public.binding_race_results WHERE session = 'prep_a';
  IF NOT FOUND OR NOT r.ok OR r.replayed OR r.reused THEN RAISE EXCEPTION 'prepare A must mint fresh, got %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.binding_race_results WHERE session = 'prep_b';
  IF NOT FOUND OR NOT r.ok OR r.replayed OR NOT r.reused THEN RAISE EXCEPTION 'prepare B must reuse, got %', row_to_json(r); END IF;
  PERFORM 1 FROM public.binding_race_results a JOIN public.binding_race_results b
    ON a.session = 'prep_a' AND b.session = 'prep_b' AND a.ref_id = b.ref_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepare reuse must return the same session'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = 'cccccccc-e000-4000-8000-000000000000';
  IF v_count <> 1 THEN RAISE EXCEPTION 'exactly one session must exist, found %', v_count; END IF;

  SELECT * INTO r FROM public.binding_race_results WHERE session = 'same_a';
  IF NOT FOUND OR NOT r.ok OR r.replayed OR r.reused THEN RAISE EXCEPTION 'same-op A must mint fresh, got %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.binding_race_results WHERE session = 'same_b';
  IF NOT FOUND OR NOT r.ok OR NOT r.replayed OR r.reused THEN RAISE EXCEPTION 'same-op B must replay, got %', row_to_json(r); END IF;
  PERFORM 1 FROM public.binding_race_results a JOIN public.binding_race_results b
    ON a.session = 'same_a' AND b.session = 'same_b' AND a.ref_id = b.ref_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'same-op reuse must return the same session'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_cart_checkout_sessions
  WHERE cart_id = 'cccccccc-f000-4000-8000-000000000000';
  IF v_count <> 1 THEN RAISE EXCEPTION 'exactly one same-op session must exist, found %', v_count; END IF;
END
$$;
\endif
