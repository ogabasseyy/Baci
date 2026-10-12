-- REGRESSION TEST: creation results carry the server-minted grant id.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres \
--     -d cart_grant -f supabase/tests/commerce_cart_create_grant.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- Minimal catalog stubs exposing exactly the columns the command RPCs read.
CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  price numeric(10,2) NOT NULL,
  status text NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  manage_stock boolean NOT NULL DEFAULT true
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  price_override numeric(10,2) NULL
);

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
\ir ../migrations/20261012050200_commerce_cart_commands.sql
\ir ../migrations/20261012050400_commerce_cart_create_grant.sql

INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 25.00, 'active', 10, 10, true);

-- 1. Fresh creation returns the grant id minted in the same transaction.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-grant","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_grant text;
BEGIN
  SELECT public.commerce_cart_create('op-grant-1', '[]'::jsonb, 'NGN') INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'create must succeed, got %', v_result; END IF;
  v_grant := v_result ->> 'grantId';
  IF v_grant IS NULL OR v_grant !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'create must return a uuid grantId, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 2. The returned grant id matches the stored creation receipt and grant row.
DO $$
DECLARE
  v_result jsonb;
  v_grant text;
  v_count integer;
BEGIN
  SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-grant","cart_scope":"bootstrap"}';
  SET ROLE commerce_cart_shopper;
  SELECT public.commerce_cart_create('op-grant-1', '[]'::jsonb, 'NGN') INTO v_result;
  RESET ROLE;
  v_grant := v_result ->> 'grantId';
  SELECT count(*) INTO v_count
  FROM public.commerce_cart_creation_requests r
  JOIN public.commerce_cart_grants g ON g.id = r.grant_id
  WHERE r.merchant_id = '11111111-1111-4111-8111-111111111111'
    AND r.principal_id = 'guest-grant'
    AND r.operation_id = 'op-grant-1'
    AND r.grant_id::text = v_grant;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'grantId must match the stored receipt and grant, got %', v_result;
  END IF;
END
$$;

-- 3. Replays converge on the same grant id instead of minting another grant.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-grant","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_replay jsonb;
BEGIN
  SELECT public.commerce_cart_create('op-grant-replay', '[]'::jsonb, 'NGN') INTO v_first;
  SELECT public.commerce_cart_create('op-grant-replay', '[]'::jsonb, 'NGN') INTO v_replay;
  IF NOT (v_replay ->> 'replayed')::boolean THEN RAISE EXCEPTION 'second call must replay, got %', v_replay; END IF;
  IF (v_replay ->> 'grantId') IS NULL OR (v_replay ->> 'grantId') <> (v_first ->> 'grantId') THEN
    RAISE EXCEPTION 'replay must return the original grantId, got % then %', v_first, v_replay;
  END IF;
END
$$;
RESET ROLE;

-- 4. Failed creations carry no grant id.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-grant","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_create(
    'op-grant-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    'NGN'
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'conflicting digest must fail, got %', v_result; END IF;
  IF (v_result ->> 'code') <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'conflicting digest must report idempotency_conflict, got %', v_result;
  END IF;
  IF (v_result ->> 'grantId') IS NOT NULL THEN
    RAISE EXCEPTION 'failures must not carry a grantId, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

ROLLBACK;
