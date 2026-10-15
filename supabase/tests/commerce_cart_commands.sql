-- REGRESSION TEST: shared cart atomic commands, replay and pricing.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres \
--     -d cart_cmd -f supabase/tests/commerce_cart_commands.sql

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
CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  premium_features jsonb NOT NULL DEFAULT '[]'::jsonb
);
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

INSERT INTO public.merchants (id, premium_features) VALUES
  ('11111111-1111-4111-8111-111111111111', '["shared_cart","shared_cart_accounts","shared_cart_realtime"]'::jsonb),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[]'::jsonb);

INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 25.00, 'active', 10, 10, true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 10.00, 'draft', 5, 5, true),
  ('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5.00, 'active', 5, 5, true),
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 7.50, 'active', 0, 0, true);
INSERT INTO public.product_variants (id, product_id, merchant_id, price_override) VALUES
  ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 30.00),
  ('88888888-8888-4888-8888-888888888888', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL);

INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-old', now() - interval '1 hour', NULL);

-- 1. Bootstrap creation produces one cart, grant and receipt.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-new","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_carts integer;
BEGIN
  v_result := public.commerce_cart_create('create-1', '[]'::jsonb, 'NGN');
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'creation must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 1 THEN RAISE EXCEPTION 'new cart must start at version 1'; END IF;
  IF (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'first creation must not replay'; END IF;
  SELECT count(*) INTO v_carts FROM public.commerce_cart_creation_requests
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND principal_id = 'guest-new';
  -- Shopper has no direct receipt read; count via owner check below instead.
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_carts integer;
  v_grants integer;
  v_receipts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111';
  IF v_carts <> 2 THEN RAISE EXCEPTION 'expected fixture cart plus one created cart, got %', v_carts; END IF;
  SELECT count(*) INTO v_receipts FROM public.commerce_cart_creation_requests
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND principal_id = 'guest-new';
  IF v_receipts <> 1 THEN RAISE EXCEPTION 'expected one creation receipt, got %', v_receipts; END IF;
END
$$;

-- 2. Duplicate creation with the same key and body replays the same cart.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-new","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.commerce_cart_create('create-1', '[]'::jsonb, 'NGN');
  v_second := public.commerce_cart_create('create-1', '[]'::jsonb, 'NGN');
  IF NOT (v_second ->> 'replayed')::boolean THEN RAISE EXCEPTION 'duplicate creation must replay'; END IF;
  IF v_first -> 'state' ->> 'cartId' <> v_second -> 'state' ->> 'cartId' THEN
    RAISE EXCEPTION 'replayed creation must return the same cart';
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111';
  IF v_carts <> 2 THEN RAISE EXCEPTION 'duplicate creation must not add a cart, got %', v_carts; END IF;
END
$$;

-- 3. Same creation key with a different body conflicts.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-new","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_create(
    'create-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'key/body mismatch must conflict, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 4. Creation validates initial lines against the catalog.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-lines","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_create(
    'create-lines',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}]'::jsonb,
    'NGN'
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'valid initial lines must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'unitPriceMinor')::integer <> 2500 THEN
    RAISE EXCEPTION 'initial line must carry the catalog price in minor units, got %', v_result;
  END IF;
  v_result := public.commerce_cart_create(
    'create-draft',
    '[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1}]'::jsonb,
    'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'delisted initial line must fail invalid, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 5. Duplicate add replays once; a retry never duplicates quantity.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-add-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}'::jsonb
  );
  IF NOT (v_first ->> 'ok')::boolean THEN RAISE EXCEPTION 'add must succeed, got %', v_first; END IF;
  IF (v_first -> 'state' ->> 'version')::integer <> 2 THEN RAISE EXCEPTION 'add must bump to version 2'; END IF;
  v_second := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-add-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}'::jsonb
  );
  IF NOT (v_second ->> 'replayed')::boolean THEN RAISE EXCEPTION 'duplicate add must replay'; END IF;
  IF (v_second -> 'state' -> 'lines' -> 0 ->> 'quantity')::integer <> 2 THEN
    RAISE EXCEPTION 'replay must not duplicate quantity, got %', v_second;
  END IF;
END
$$;
RESET ROLE;

-- 6. Same mutation key with a different body conflicts.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-add-1', 2,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":5}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'mutation key/body mismatch must conflict, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 7. Stale remove/set/replace conflict with the current snapshot.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_line_id text;
  v_result jsonb;
BEGIN
  SELECT id::text INTO v_line_id FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222' LIMIT 1;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-stale-remove', 1,
    jsonb_build_object('type', 'remove', 'lineId', v_line_id)
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'version_conflict' THEN
    RAISE EXCEPTION 'stale remove must conflict, got %', v_result;
  END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 2 THEN
    RAISE EXCEPTION 'conflict must carry the current version, got %', v_result;
  END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-stale-replace', 1,
    '{"type":"replace","lines":[]}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'version_conflict' THEN
    RAISE EXCEPTION 'stale replace must conflict, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 8. Sequential same-version operations cannot lose an update.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-race-a', 2,
    '{"type":"add","item":{"productId":"66666666-6666-4666-8666-666666666666"},"quantity":1}'::jsonb
  );
  v_second := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-race-b', 2,
    '{"type":"clear"}'::jsonb
  );
  IF NOT (v_first ->> 'ok')::boolean THEN RAISE EXCEPTION 'first writer must win, got %', v_first; END IF;
  IF (v_second ->> 'ok')::boolean OR v_second ->> 'code' <> 'version_conflict' THEN
    RAISE EXCEPTION 'second writer must conflict, got %', v_second;
  END IF;
END
$$;
RESET ROLE;

-- 9. Response-loss reconciliation returns the committed result.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-race-a', 2,
    '{"type":"add","item":{"productId":"66666666-6666-4666-8666-666666666666"},"quantity":1}'::jsonb
  );
  IF NOT (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'lost response must reconcile via replay'; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 3 THEN
    RAISE EXCEPTION 'replay must return the committed version, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 10. Foreign product/variant rejected; exact variant price used.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-foreign', 3,
    '{"type":"add","item":{"productId":"55555555-5555-4555-8555-555555555555"},"quantity":1}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'foreign product must be rejected, got %', v_result;
  END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-foreign-variant', 3,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333","variantId":"88888888-8888-4888-8888-888888888888"},"quantity":1}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'foreign variant must be rejected, got %', v_result;
  END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-variant-price', 3,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333","variantId":"77777777-7777-4777-8777-777777777777"},"quantity":1}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'variant add must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_price integer;
BEGIN
  -- Owner-side check of the exact variant override price path.
  SELECT 1 INTO v_price FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222'
    AND variant_id = '77777777-7777-4777-8777-777777777777';
  IF NOT FOUND THEN RAISE EXCEPTION 'variant line must exist'; END IF;
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_snapshot jsonb;
  v_line jsonb;
BEGIN
  v_snapshot := public.commerce_cart_snapshot('22222222-2222-4222-8222-222222222222');
  SELECT value INTO v_line FROM jsonb_array_elements(v_snapshot -> 'state' -> 'lines') value
  WHERE value ->> 'variantId' = '77777777-7777-4777-8777-777777777777';
  IF v_line IS NULL THEN RAISE EXCEPTION 'snapshot must include the variant line'; END IF;
  IF (v_line ->> 'unitPriceMinor')::integer <> 3000 THEN
    RAISE EXCEPTION 'variant override price must be exact, got %', v_line;
  END IF;
END
$$;
RESET ROLE;

-- 11. Older committed operation recalled after a newer mutation replays
-- without rewriting current state.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-add-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}'::jsonb
  );
  IF NOT (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'old operation must replay'; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 2 THEN
    RAISE EXCEPTION 'replay must return the committed version, got %', v_result;
  END IF;
  IF (v_result ->> 'currentVersion')::integer <> 4 THEN
    RAISE EXCEPTION 'replay must disclose the current version, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 12. Pruned replay bodies conflict instead of re-executing.
DO $$
BEGIN
  UPDATE public.commerce_cart_operations SET result = NULL
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND cart_id = '22222222-2222-4222-8222-222222222222'
    AND principal_id = 'guest-a1' AND operation_id = 'op-add-1';
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_qty integer;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-add-1', 1,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'pruned replay must conflict, got %', v_result;
  END IF;
  SELECT quantity INTO v_qty FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222'
    AND product_id = '33333333-3333-4333-8333-333333333333' AND variant_id IS NULL;
  IF v_qty <> 2 THEN RAISE EXCEPTION 'pruned retry must not become a new add, qty %', v_qty; END IF;
END
$$;
RESET ROLE;

-- 13. Removal and reduction survive catalog failure; increases do not.
DO $$
BEGIN
  UPDATE public.products SET status = 'draft'
  WHERE id = '33333333-3333-4333-8333-333333333333';
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_line_id text;
  v_result jsonb;
BEGIN
  SELECT id::text INTO v_line_id FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222'
    AND product_id = '33333333-3333-4333-8333-333333333333' AND variant_id IS NULL;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-reduce-dark', 4,
    jsonb_build_object('type', 'set_quantity', 'lineId', v_line_id, 'quantity', 1)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'reduction during outage must succeed, got %', v_result; END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-increase-dark', 5,
    jsonb_build_object('type', 'set_quantity', 'lineId', v_line_id, 'quantity', 2)
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'increase during outage must fail invalid, got %', v_result;
  END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-remove-dark', 5,
    jsonb_build_object('type', 'remove', 'lineId', v_line_id)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'removal during outage must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
DO $$
BEGIN
  UPDATE public.products SET status = 'active'
  WHERE id = '33333333-3333-4333-8333-333333333333';
END
$$;

-- 14. Removing an absent line is a no-op that preserves the version.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-remove-missing', 6,
    '{"type":"remove","lineId":"00000000-0000-4000-8000-000000000000"}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'absent removal must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 6 THEN
    RAISE EXCEPTION 'no-op must preserve the version, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 15. Last removal keeps the cart active; clearing an empty cart is a no-op.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-clear-all', 6,
    '{"type":"clear"}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'clear must succeed, got %', v_result; END IF;
  IF v_result -> 'state' ->> 'state' <> 'active' THEN RAISE EXCEPTION 'emptied cart must stay active'; END IF;
  IF jsonb_array_length(v_result -> 'state' -> 'lines') <> 0 THEN RAISE EXCEPTION 'clear must empty lines'; END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-clear-empty', 7,
    '{"type":"clear"}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'empty clear must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 7 THEN
    RAISE EXCEPTION 'empty clear must preserve the version, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 16. Rollback leaves no partial cart, operation or event rows.
DO $$
DECLARE
  v_ops integer;
  v_events integer;
BEGIN
  SELECT count(*) INTO v_ops FROM public.commerce_cart_operations
  WHERE operation_id IN ('op-stale-remove', 'op-stale-replace', 'op-race-b', 'op-foreign');
  IF v_ops <> 0 THEN RAISE EXCEPTION 'failed operations must leave no receipts, got %', v_ops; END IF;
  SELECT count(*) INTO v_events FROM public.commerce_cart_events
  WHERE operation_id IN ('op-stale-remove', 'op-stale-replace', 'op-race-b', 'op-foreign');
  IF v_events <> 0 THEN RAISE EXCEPTION 'failed operations must leave no events, got %', v_events; END IF;
END
$$;

-- 17. Non-active carts reject mutations but stay readable.
DO $$
BEGIN
  UPDATE public.commerce_carts SET state = 'checkout'
  WHERE id = '22222222-2222-4222-8222-222222222222';
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_snapshot jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-locked', 7,
    '{"type":"clear"}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'cart_locked' THEN
    RAISE EXCEPTION 'checkout cart must lock mutations, got %', v_result;
  END IF;
  v_snapshot := public.commerce_cart_snapshot('22222222-2222-4222-8222-222222222222');
  IF NOT (v_snapshot ->> 'ok')::boolean THEN RAISE EXCEPTION 'locked cart must stay readable, got %', v_snapshot; END IF;
END
$$;
RESET ROLE;
DO $$
BEGIN
  UPDATE public.commerce_carts SET state = 'active'
  WHERE id = '22222222-2222-4222-8222-222222222222';
END
$$;

-- 18. Voucher lines pin quantity 1 and stay distinct per voucher.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-voucher-1', 7,
    '{"type":"add","item":{"productId":"66666666-6666-4666-8666-666666666666"},"quantity":5,"voucherToken":"tok-1","voucherAwardId":"99999999-9999-4999-8999-999999999993"}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'voucher add must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'quantity')::integer <> 1 THEN
    RAISE EXCEPTION 'voucher line must pin quantity 1, got %', v_result;
  END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-voucher-2', 8,
    '{"type":"add","item":{"productId":"66666666-6666-4666-8666-666666666666"},"quantity":1,"voucherToken":"tok-2","voucherAwardId":"99999999-9999-4999-8999-999999999994"}'::jsonb
  );
  IF jsonb_array_length(v_result -> 'state' -> 'lines') <> 2 THEN
    RAISE EXCEPTION 'distinct vouchers must stay distinct lines, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 19. Negotiations above the catalog price invalidate with a flag.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_line jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-neg-1', 9,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1,"negotiatedUnitPriceMinor":3000}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'negotiated add must succeed, got %', v_result; END IF;
  SELECT value INTO v_line FROM jsonb_array_elements(v_result -> 'state' -> 'lines') value
  WHERE value ->> 'productId' = '33333333-3333-4333-8333-333333333333';
  IF NOT (v_line ->> 'negotiationInvalidated')::boolean THEN
    RAISE EXCEPTION 'above-catalog negotiation must invalidate, got %', v_line;
  END IF;
  IF (v_line ->> 'unitPriceMinor')::integer <> 2500 THEN
    RAISE EXCEPTION 'invalidated line must reprice to catalog, got %', v_line;
  END IF;
END
$$;
RESET ROLE;

-- 20. Expired grants cannot mutate.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999992","cart_principal_id":"guest-old","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-expired-grant', 10,
    '{"type":"clear"}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'expired' THEN
    RAISE EXCEPTION 'expired grant must fail expired, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 21. Repeated replaces in one transaction succeed (no temp-table residue).
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-replace-twice-1', 10,
    '{"type":"replace","lines":[]}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'first replace must succeed, got %', v_result; END IF;
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-replace-twice-2', 11,
    '{"type":"replace","lines":[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'second replace must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 12 THEN
    RAISE EXCEPTION 'replaces must advance the version, got %', v_result;
  END IF;
END
$$;
RESET ROLE;


-- 15. set_assurance persists the shopper choice at the server-owned rate.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_line_id text;
  v_result jsonb;
  v_version integer;
BEGIN
  SELECT id::text INTO v_line_id FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222' LIMIT 1;
  SELECT version INTO v_version FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222';
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-assurance-on', v_version,
    jsonb_build_object('type', 'set_assurance', 'lineId', v_line_id, 'hasAssurance', true)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'assurance on must succeed, got %', v_result; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE id = v_line_id::uuid AND has_assurance AND assurance_rate = 0.05
  ) THEN RAISE EXCEPTION 'assurance must persist at the server rate'; END IF;
  SELECT version INTO v_version FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222';
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-assurance-off', v_version,
    jsonb_build_object('type', 'set_assurance', 'lineId', v_line_id, 'hasAssurance', false)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'assurance off must succeed, got %', v_result; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE id = v_line_id::uuid AND NOT has_assurance AND assurance_rate IS NULL
  ) THEN RAISE EXCEPTION 'assurance off must clear the rate'; END IF;
END
$$;
RESET ROLE;

-- 16. set_negotiated_price reprices in place and clears back to catalog.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_line_id text;
  v_line_count integer;
  v_result jsonb;
  v_version integer;
BEGIN
  SELECT id::text INTO v_line_id FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222' LIMIT 1;
  SELECT count(*) INTO v_line_count FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222';
  SELECT version INTO v_version FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222';
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-reprice-on', v_version,
    jsonb_build_object('type', 'set_negotiated_price', 'lineId', v_line_id, 'negotiatedUnitPriceMinor', 2000)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'reprice must succeed, got %', v_result; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE id = v_line_id::uuid AND negotiated_unit_price_minor = 2000 AND negotiation_status = 'accepted'
  ) THEN RAISE EXCEPTION 'reprice must persist on the same line'; END IF;
  IF (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id = '22222222-2222-4222-8222-222222222222') <> v_line_count
    OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE id = v_line_id::uuid) THEN
    RAISE EXCEPTION 'reprice must not move or recreate the line'; END IF;
  SELECT version INTO v_version FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222';
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-reprice-at-catalog', v_version,
    jsonb_build_object('type', 'set_negotiated_price', 'lineId', v_line_id, 'negotiatedUnitPriceMinor', 2500)
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'reprice at catalog price must be rejected, got %', v_result; END IF;
  SELECT version INTO v_version FROM public.commerce_carts
  WHERE id = '22222222-2222-4222-8222-222222222222';
  v_result := public.commerce_cart_mutate(
    '22222222-2222-4222-8222-222222222222', 'op-reprice-clear', v_version,
    jsonb_build_object('type', 'set_negotiated_price', 'lineId', v_line_id, 'negotiatedUnitPriceMinor', null)
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'reprice clear must succeed, got %', v_result; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE id = v_line_id::uuid AND negotiated_unit_price_minor IS NULL AND negotiation_status IS NULL
  ) THEN RAISE EXCEPTION 'reprice clear must restore catalog pricing'; END IF;
END
$$;
RESET ROLE;

ROLLBACK;
