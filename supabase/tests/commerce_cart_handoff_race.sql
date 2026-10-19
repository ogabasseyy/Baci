-- RACE TEST: two concurrent merges of the same handoff grant, plus two
-- concurrent issues under one operation key with different bodies.
--
-- Run only against an empty disposable PostgreSQL database (never
-- production). Database for this file: cart_race.
--
--   export PG="psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres -d cart_race"
--   export F=supabase/tests/commerce_cart_handoff_race.sql
--   $PG -v DO_SETUP=1 -f $F
--   python3 /tmp/baci-cart-handoff-race/runner.py   # A then B, overlapping
--   RACE_SUFFIX=_I python3 /tmp/baci-cart-handoff-race/runner.py
--   $PG -v DO_CHECK=1 -f $F
--
-- Session A holds its transaction open for 6 seconds while redeeming
-- with attempt-A; session B starts ~1s later with attempt-B, waits on
-- the grant lock, then loses: exactly one merge applies and the loser
-- observes handoff_consumed without touching either cart.
--
-- The issue race is the same shape on the operation-key lock: session
-- AI holds its issue open while session BI blocks on the key lock,
-- then observes idempotency_conflict instead of minting a second
-- grant for the same key.

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
  price_override numeric(10,2) NULL
);
\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
\ir ../migrations/20261012050200_commerce_cart_commands.sql
\ir ../migrations/20261012050400_commerce_cart_create_grant.sql
\ir ../migrations/20261012050500_commerce_cart_handoff.sql
CREATE TABLE IF NOT EXISTS public.handoff_race_results (
  session text PRIMARY KEY, ok boolean NOT NULL, code text NULL
);
GRANT INSERT, SELECT ON public.handoff_race_results TO commerce_cart_shopper;
DELETE FROM public.handoff_race_results;
INSERT INTO public.merchants (id, slug) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ogabassey')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 250.00, 'active', 10, 10, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('70707070-7070-4707-8707-707070707070', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.commerce_cart_lines
WHERE cart_id IN ('22222222-2222-4222-8222-222222222222', '77777777-7777-4777-8777-777777777777', '70707070-7070-4707-8707-707070707070');
INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 1, 25000);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-origin', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', 'guest-a', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999993', '11111111-1111-4111-8111-111111111111', '70707070-7070-4707-8707-707070707070', 'guest-b', now() + interval '7 days', NULL)
ON CONFLICT (id) DO NOTHING;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
SELECT public.commerce_cart_issue_handoff(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  'handoff-op-race',
  '{"type":"web"}'::jsonb
);
RESET ROLE;
\endif

\if :{?DO_A}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a","cart_scope":"session","cart_id":"77777777-7777-4777-8777-777777777777","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attempt-race-a', 'merge', 'web',
    '77777777-7777-4777-8777-777777777777', 1, 1,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    NULL
  ) INTO v_result;
  INSERT INTO public.handoff_race_results (session, ok, code)
  VALUES ('a', (v_result ->> 'ok')::boolean, v_result ->> 'code');
END
$$;
SELECT pg_sleep(6);
COMMIT;
\endif

\if :{?DO_B}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-b","cart_scope":"session","cart_id":"70707070-7070-4707-8707-707070707070","cart_grant_id":"99999999-9999-4999-8999-999999999993"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attempt-race-b', 'merge', 'web',
    '70707070-7070-4707-8707-707070707070', 1, 1,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    NULL
  ) INTO v_result;
  INSERT INTO public.handoff_race_results (session, ok, code)
  VALUES ('b', (v_result ->> 'ok')::boolean, v_result ->> 'code');
END
$$;
COMMIT;
\endif

\if :{?DO_A_I}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a',
    '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-race-issue',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  INSERT INTO public.handoff_race_results (session, ok, code)
  VALUES ('ai', (v_result ->> 'ok')::boolean, v_result ->> 'code');
END
$$;
SELECT pg_sleep(6);
COMMIT;
\endif

\if :{?DO_B_I}
BEGIN;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b',
    '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-race-issue',
    '{"type":"native","app":"storefront"}'::jsonb
  ) INTO v_result;
  INSERT INTO public.handoff_race_results (session, ok, code)
  VALUES ('bi', (v_result ->> 'ok')::boolean, v_result ->> 'code');
END
$$;
COMMIT;
\endif

\if :{?DO_CHECK}
DO $$
DECLARE
  v_a_ok boolean;
  v_a_code text;
  v_b_ok boolean;
  v_b_code text;
  v_ai_ok boolean;
  v_ai_code text;
  v_bi_ok boolean;
  v_bi_code text;
  v_lines_a integer;
  v_lines_b integer;
  v_attempt text;
  v_issue_grants integer;
BEGIN
  SELECT ok, code INTO v_a_ok, v_a_code FROM public.handoff_race_results WHERE session = 'a';
  SELECT ok, code INTO v_b_ok, v_b_code FROM public.handoff_race_results WHERE session = 'b';
  IF v_a_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'session A must win, got ok=% code=%', v_a_ok, v_a_code; END IF;
  IF v_b_ok IS DISTINCT FROM false OR v_b_code IS DISTINCT FROM 'handoff_consumed' THEN
    RAISE EXCEPTION 'session B must observe handoff_consumed, got ok=% code=%', v_b_ok, v_b_code;
  END IF;
  SELECT count(*) INTO v_lines_a FROM public.commerce_cart_lines
  WHERE cart_id = '77777777-7777-4777-8777-777777777777';
  SELECT count(*) INTO v_lines_b FROM public.commerce_cart_lines
  WHERE cart_id = '70707070-7070-4707-8707-707070707070';
  IF v_lines_a <> 1 THEN RAISE EXCEPTION 'winner merge must apply once'; END IF;
  IF v_lines_b <> 0 THEN RAISE EXCEPTION 'loser merge must apply nothing'; END IF;
  SELECT destination_attempt_id INTO v_attempt FROM public.commerce_cart_handoffs
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF v_attempt <> 'attempt-race-a' THEN RAISE EXCEPTION 'winning attempt must be recorded'; END IF;
  SELECT ok, code INTO v_ai_ok, v_ai_code FROM public.handoff_race_results WHERE session = 'ai';
  SELECT ok, code INTO v_bi_ok, v_bi_code FROM public.handoff_race_results WHERE session = 'bi';
  IF v_ai_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'issue session AI must win, got ok=% code=%', v_ai_ok, v_ai_code; END IF;
  IF v_bi_ok IS DISTINCT FROM false OR v_bi_code IS DISTINCT FROM 'idempotency_conflict' THEN
    RAISE EXCEPTION 'issue session BI must observe idempotency_conflict, got ok=% code=%', v_bi_ok, v_bi_code;
  END IF;
  SELECT count(*) INTO v_issue_grants FROM public.commerce_cart_handoffs
  WHERE operation_id = 'handoff-op-race-issue';
  IF v_issue_grants <> 1 THEN RAISE EXCEPTION 'racing issues must mint exactly one grant'; END IF;
END
$$;
\endif
