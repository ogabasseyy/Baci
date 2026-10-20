-- CONCURRENCY TEST: duplicate-operation serialization and lost-update
-- prevention across two real database sessions.
--
-- Run only against an empty disposable PostgreSQL database (never
-- production). Database for this file: cart_conc.
--
--   export PG="psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres -d cart_conc"
--   export F=supabase/tests/commerce_cart_concurrency.sql
--   $PG -v DO_SETUP=1 -f $F
--   # Per scenario, run the A and B invocations in two parallel sessions,
--   # then the check after both finish:
--   $PG -v DO_A=1 -v SC_REPLAY=1 -f $F & $PG -v DO_B=1 -v SC_REPLAY=1 -f $F
--   $PG -v DO_CHECK=1 -v SC_REPLAY=1 -f $F
--   (repeat for SC_CONFLICT and SC_CREATE)
--
-- Session A holds its transaction open for 8 seconds so session B must wait
-- on the operation lock (replay/create) or the cart row lock (conflict);
-- the check asserts B waited, exactly one execution won, and no duplicate
-- quantity, lost update or second cart exists. Start B within A's hold
-- window (a launcher that staggers by ~1s works); a B that arrives after
-- A commits replays without waiting and fails the wait assertion.

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
INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 25.00, 'active', 100, 100, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('c2222222-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at) VALUES
  ('c1111111-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'guest-r', now() + interval '7 days'),
  ('c2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111', 'guest-c', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.conc_probe (
  scenario text NOT NULL, session text NOT NULL, ok boolean NOT NULL,
  replayed boolean NOT NULL, code text NULL, version integer NULL,
  cart text NULL, qty integer NULL, duration_ms integer NOT NULL,
  PRIMARY KEY (scenario, session)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_probe TO commerce_cart_shopper;
DELETE FROM public.conc_probe;
-- Reset scenario fixtures so the file is re-runnable in one database.
DELETE FROM public.commerce_cart_operations WHERE cart_id IN
  ('c1111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111');
DELETE FROM public.commerce_cart_events WHERE cart_id IN
  ('c1111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111');
DELETE FROM public.commerce_cart_lines WHERE cart_id IN
  ('c1111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111');
UPDATE public.commerce_carts SET version = 1, state = 'active', updated_at = now()
WHERE id IN ('c1111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111');
DELETE FROM public.commerce_cart_creation_requests
WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND principal_id = 'guest-conc';
DELETE FROM public.commerce_carts WHERE id NOT IN
  ('c1111111-1111-4111-8111-111111111111', 'c2222222-1111-4111-8111-111111111111');
\endif

\if :{?DO_A}
\set claims_replay '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"c1111111-1111-4111-8111-111111111111","cart_grant_id":"c1111111-2222-4222-8222-222222222222","cart_principal_id":"guest-r","cart_scope":"session"}'
\set claims_conflict '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"c2222222-1111-4111-8111-111111111111","cart_grant_id":"c2222222-2222-4222-8222-222222222222","cart_principal_id":"guest-c","cart_scope":"session"}'
\set claims_create '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-conc","cart_scope":"bootstrap"}'
BEGIN;
\if :{?SC_REPLAY}
SET request.jwt.claims = :'claims_replay';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_mutate(
    'c1111111-1111-4111-8111-111111111111', 'conc-op-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}'::jsonb
  );
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('replay', 'a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    v_result -> 'state' ->> 'cartId', NULL,
    (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
\endif
\if :{?SC_CONFLICT}
SET request.jwt.claims = :'claims_conflict';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_mutate(
    'c2222222-1111-4111-8111-111111111111', 'conc-op-a', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}'::jsonb
  );
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('conflict', 'a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    NULL, NULL, (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
\endif
\if :{?SC_CREATE}
SET request.jwt.claims = :'claims_create';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_create('conc-create-1', '[]'::jsonb, 'NGN');
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('create', 'a', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    v_result -> 'state' ->> 'cartId', NULL,
    (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
\endif
RESET ROLE;
SELECT pg_sleep(8);
COMMIT;
\endif

\if :{?DO_B}
-- Stagger so A reaches its lock first; checks stay order-agnostic anyway.
SELECT pg_sleep(1.0);
\set claims_replay '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"c1111111-1111-4111-8111-111111111111","cart_grant_id":"c1111111-2222-4222-8222-222222222222","cart_principal_id":"guest-r","cart_scope":"session"}'
\set claims_conflict '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"c2222222-1111-4111-8111-111111111111","cart_grant_id":"c2222222-2222-4222-8222-222222222222","cart_principal_id":"guest-c","cart_scope":"session"}'
\set claims_create '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-conc","cart_scope":"bootstrap"}'
\if :{?SC_REPLAY}
SET request.jwt.claims = :'claims_replay';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_mutate(
    'c1111111-1111-4111-8111-111111111111', 'conc-op-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}'::jsonb
  );
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('replay', 'b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    v_result -> 'state' ->> 'cartId', NULL,
    (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
RESET ROLE;
\endif
\if :{?SC_CONFLICT}
SET request.jwt.claims = :'claims_conflict';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_mutate(
    'c2222222-1111-4111-8111-111111111111', 'conc-op-b', 1,
    '{"type":"clear"}'::jsonb
  );
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('conflict', 'b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    NULL, NULL, (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
RESET ROLE;
\endif
\if :{?SC_CREATE}
SET request.jwt.claims = :'claims_create';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  v_result := public.commerce_cart_create('conc-create-1', '[]'::jsonb, 'NGN');
  INSERT INTO public.conc_probe (scenario, session, ok, replayed, code, version, cart, qty, duration_ms)
  VALUES ('create', 'b', (v_result ->> 'ok')::boolean, (v_result ->> 'replayed')::boolean,
    v_result ->> 'code', (v_result -> 'state' ->> 'version')::integer,
    v_result -> 'state' ->> 'cartId', NULL,
    (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer);
END
$$;
RESET ROLE;
\endif
\endif

\if :{?DO_CHECK}
\if :{?SC_REPLAY}
DO $$
DECLARE
  v_winner public.conc_probe%ROWTYPE;
  v_loser public.conc_probe%ROWTYPE;
  v_qty integer;
BEGIN
  SELECT * INTO v_winner FROM public.conc_probe
  WHERE scenario = 'replay' AND ok AND NOT replayed;
  SELECT * INTO v_loser FROM public.conc_probe
  WHERE scenario = 'replay' AND ok AND replayed;
  IF v_winner IS NULL OR v_loser IS NULL THEN RAISE EXCEPTION 'replay needs one execution plus one replay'; END IF;
  IF v_loser.duration_ms < 1500 THEN RAISE EXCEPTION 'loser must have waited on the lock, waited %ms', v_loser.duration_ms; END IF;
  SELECT quantity INTO v_qty FROM public.commerce_cart_lines
  WHERE cart_id = 'c1111111-1111-4111-8111-111111111111';
  IF v_qty <> 1 THEN RAISE EXCEPTION 'concurrent duplicate must add once, qty %', v_qty; END IF;
END
$$;
\endif
\if :{?SC_CONFLICT}
DO $$
DECLARE
  v_winner public.conc_probe%ROWTYPE;
  v_loser public.conc_probe%ROWTYPE;
  v_version integer;
BEGIN
  SELECT * INTO v_winner FROM public.conc_probe WHERE scenario = 'conflict' AND ok;
  SELECT * INTO v_loser FROM public.conc_probe WHERE scenario = 'conflict' AND NOT ok;
  IF v_winner IS NULL OR v_loser IS NULL THEN RAISE EXCEPTION 'conflict needs one winner plus one loser'; END IF;
  IF v_loser.code <> 'version_conflict' THEN RAISE EXCEPTION 'loser must conflict, got %', v_loser.code; END IF;
  IF v_loser.duration_ms < 1500 THEN RAISE EXCEPTION 'loser must have waited on the row lock, waited %ms', v_loser.duration_ms; END IF;
  SELECT version INTO v_version FROM public.commerce_carts WHERE id = 'c2222222-1111-4111-8111-111111111111';
  IF v_version <> 2 THEN RAISE EXCEPTION 'loser must not move the version, got %', v_version; END IF;
END
$$;
\endif
\if :{?SC_CREATE}
DO $$
DECLARE
  v_winner public.conc_probe%ROWTYPE;
  v_loser public.conc_probe%ROWTYPE;
  v_receipts integer;
  v_carts integer;
BEGIN
  SELECT * INTO v_winner FROM public.conc_probe WHERE scenario = 'create' AND NOT replayed;
  SELECT * INTO v_loser FROM public.conc_probe WHERE scenario = 'create' AND replayed;
  IF v_winner IS NULL OR v_loser IS NULL THEN RAISE EXCEPTION 'create needs one execution plus one replay'; END IF;
  IF v_winner.cart IS NULL OR v_winner.cart <> v_loser.cart THEN
    RAISE EXCEPTION 'concurrent creation must converge on one cart, got % vs %', v_winner.cart, v_loser.cart;
  END IF;
  IF v_loser.duration_ms < 1500 THEN RAISE EXCEPTION 'loser must have waited on the lock, waited %ms', v_loser.duration_ms; END IF;
  SELECT count(*) INTO v_receipts FROM public.commerce_cart_creation_requests
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND principal_id = 'guest-conc' AND operation_id = 'conc-create-1';
  IF v_receipts <> 1 THEN RAISE EXCEPTION 'expected one creation receipt, got %', v_receipts; END IF;
END
$$;
\endif
\endif
