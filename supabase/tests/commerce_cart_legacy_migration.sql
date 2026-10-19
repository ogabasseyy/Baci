-- REGRESSION TEST: legacy MCP/UCP cart migration without duplicate writers.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres \
--     -d cart_leg -f supabase/tests/commerce_cart_legacy_migration.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  premium_features jsonb NOT NULL DEFAULT '[]'::jsonb
);
INSERT INTO public.merchants (id, slug, premium_features) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ogabassey', '["shared_cart","shared_cart_accounts","shared_cart_realtime"]'::jsonb);
CREATE TABLE public.products (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, price numeric(10,2) NOT NULL,
  status text NOT NULL, stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0, manage_stock boolean NOT NULL DEFAULT true
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY, product_id uuid NOT NULL, merchant_id uuid NOT NULL,
  price_override numeric(10,2) NULL
);

-- Minimal legacy-table stubs exposing the columns the migration touches.
CREATE TABLE public.mcp_guest_carts (
  token text PRIMARY KEY CHECK (token ~ '^[a-f0-9]{64}$'),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agentic_cart_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id text NOT NULL UNIQUE,
  merchant_id uuid NOT NULL,
  cart_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'NGN',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
\ir ../migrations/20261012050200_commerce_cart_commands.sql
\ir ../migrations/20261012050300_commerce_cart_legacy_migration.sql

-- Test-only scaffolding: the real adapters read their own legacy rows
-- through privileged server paths; the disposable stubs have no RLS, so a
-- direct SELECT grant simulates that server-side read.
GRANT SELECT ON public.agentic_cart_sessions TO commerce_cart_shopper;

INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 25.00, 'active', 100, 100, true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 10.00, 'draft', 5, 5, true),
  ('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5.00, 'active', 5, 5, true);
INSERT INTO public.product_variants (id, product_id, merchant_id, price_override) VALUES
  ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 30.00);

INSERT INTO public.mcp_guest_carts (token, items, expires_at, version) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   '[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":2}]'::jsonb,
   now() + interval '7 days', 1),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   '[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]'::jsonb,
   now() + interval '7 days', 1),
  ('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   '[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1}]'::jsonb,
   now() + interval '7 days', 1);
INSERT INTO public.agentic_cart_sessions (cart_id, merchant_id, cart_items) VALUES
  ('ucp-cart-legacy-001', '11111111-1111-4111-8111-111111111111',
   '[{"id":"33333333-3333-4333-8333-333333333333","quantity":3}]'::jsonb),
  ('ucp-cart-legacy-002', '11111111-1111-4111-8111-111111111111',
   '[{"id":"33333333-3333-4333-8333-333333333333","quantity":1}]'::jsonb);

-- 1. Token hashes match sha256 (node-computed fixtures) and backfill.
DO $$
DECLARE
  v_hash text;
BEGIN
  SELECT token_hash INTO v_hash FROM public.mcp_guest_carts
  WHERE token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  IF v_hash <> 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb' THEN
    RAISE EXCEPTION 'mcp token hash mismatch, got %', v_hash;
  END IF;
  SELECT cart_id_hash INTO v_hash FROM public.agentic_cart_sessions WHERE cart_id = 'ucp-cart-legacy-001';
  IF v_hash <> 'bccca6035f3bd26541d2daa456df5e81ad99d3529c2d325944e1ad7bc11c2335' THEN
    RAISE EXCEPTION 'ucp cart hash mismatch, got %', v_hash;
  END IF;
END
$$;

-- 2. MCP migration preserves lines exactly and mints one grant.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-1","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_line jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    'mig-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}]'::jsonb,
    '1', 'NGN'
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'migration must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 1 THEN RAISE EXCEPTION 'migrated cart must start at version 1'; END IF;
  IF jsonb_array_length(v_result -> 'state' -> 'lines') <> 1 THEN RAISE EXCEPTION 'migration must preserve line count'; END IF;
  v_line := (v_result -> 'state' -> 'lines') -> 0;
  IF (v_line ->> 'quantity')::integer <> 2 THEN RAISE EXCEPTION 'migration must preserve quantity'; END IF;
  IF (v_line ->> 'unitPriceMinor')::integer <> 2500 THEN RAISE EXCEPTION 'migration must price from catalog, got %', v_line; END IF;
  IF v_line ->> 'productId' <> '33333333-3333-4333-8333-333333333333' THEN RAISE EXCEPTION 'migration must preserve identity'; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_grants integer;
  v_refs integer;
  v_fenced uuid;
BEGIN
  SELECT count(*) INTO v_grants FROM public.commerce_cart_grants g
  JOIN public.commerce_cart_legacy_refs r ON r.cart_id = g.cart_id
  WHERE r.merchant_id = '11111111-1111-4111-8111-111111111111'
    AND r.provider = 'mcp'
    AND r.legacy_hash = 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb';
  IF v_grants <> 1 THEN RAISE EXCEPTION 'migration must mint exactly one grant, got %', v_grants; END IF;
  SELECT count(*) INTO v_refs FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND provider = 'mcp';
  IF v_refs <> 1 THEN RAISE EXCEPTION 'expected one legacy ref, got %', v_refs; END IF;
  SELECT migrated_to_cart_id INTO v_fenced FROM public.mcp_guest_carts
  WHERE token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  IF v_fenced IS NULL THEN RAISE EXCEPTION 'legacy row must be fenced atomically'; END IF;
END
$$;

-- 3. Same-operation retry returns the migration receipt.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-1","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.commerce_cart_migrate_legacy(
    'mcp', 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    'mig-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}]'::jsonb,
    '1', 'NGN'
  );
  v_second := public.commerce_cart_migrate_legacy(
    'mcp', 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    'mig-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}]'::jsonb,
    '1', 'NGN'
  );
  IF NOT (v_second ->> 'replayed')::boolean THEN RAISE EXCEPTION 'migration retry must replay'; END IF;
  IF v_first -> 'state' ->> 'cartId' <> v_second -> 'state' ->> 'cartId' THEN
    RAISE EXCEPTION 'migration replay must return the same cart';
  END IF;
END
$$;
RESET ROLE;

-- 4. A different legacy token must not attach to the migrated cart.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-1","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', 'a0fab1377f49a759b57f63318262ebe89fabfc990e8e93ceac2984561482b9d4',
    'mig-2',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'refresh_required' THEN
    RAISE EXCEPTION 'second-token migration must refresh, got %', v_result;
  END IF;
  IF v_result -> 'state' IS NULL THEN RAISE EXCEPTION 'refresh must carry the existing cart'; END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_refs integer;
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_refs FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND provider = 'mcp';
  IF v_refs <> 1 THEN RAISE EXCEPTION 'second token must not attach, refs %', v_refs; END IF;
  SELECT count(*) INTO v_carts FROM public.commerce_carts
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111';
  IF v_carts <> 1 THEN RAISE EXCEPTION 'second token must not duplicate the cart, carts %', v_carts; END IF;
END
$$;

-- 5. A different principal cannot replay someone else's mapping.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-impostor","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    'mig-3',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":2}]'::jsonb,
    '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'unauthorized' THEN
    RAISE EXCEPTION 'foreign principal replay must fail unauthorized, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 6. Stale legacy versions refresh instead of losing writes.
DO $$
BEGIN
  UPDATE public.mcp_guest_carts
  SET items = '[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":4}]'::jsonb, version = 2
  WHERE token = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-2","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', '52b6419d27bd7f547cee3b92f8c17a908b8a49601ecbec161e5030de1dfe9e0a',
    'mig-4',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'refresh_required' THEN
    RAISE EXCEPTION 'stale legacy version must refresh, got %', v_result;
  END IF;
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', '52b6419d27bd7f547cee3b92f8c17a908b8a49601ecbec161e5030de1dfe9e0a',
    'mig-4',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":4}]'::jsonb,
    '2', 'NGN'
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'fresh retry must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;

-- 7. Missing legacy carts report not_found; invalid lines fail closed.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-3","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', '0000000000000000000000000000000000000000000000000000000000000000',
    'mig-5', '[]'::jsonb, '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'not_found' THEN
    RAISE EXCEPTION 'missing legacy cart must report not_found, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
BEGIN
  INSERT INTO public.mcp_guest_carts (token, items, expires_at, version)
  VALUES ('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":1}]'::jsonb,
    now() + interval '7 days', 1);
END
$$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-mcp-3","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', encode(sha256('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'::bytea), 'hex'),
    'mig-6',
    '[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1}]'::jsonb,
    '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'delisted legacy line must fail invalid, got %', v_result;
  END IF;
  v_result := public.commerce_cart_migrate_legacy(
    'mcp', encode(sha256('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'::bytea), 'hex'),
    'mig-7',
    '[{"item":{"productId":"55555555-5555-4555-8555-555555555555"},"quantity":1}]'::jsonb,
    '1', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'foreign legacy line must fail invalid, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_refs integer;
  v_fenced uuid;
BEGIN
  SELECT count(*) INTO v_refs FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111' AND provider = 'mcp';
  IF v_refs <> 2 THEN RAISE EXCEPTION 'failed migrations must leave no refs, got %', v_refs; END IF;
  SELECT migrated_to_cart_id INTO v_fenced FROM public.mcp_guest_carts
  WHERE token = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
  IF v_fenced IS NOT NULL THEN RAISE EXCEPTION 'failed migration must not fence'; END IF;
END
$$;

-- 8. Fenced legacy rows reject writes. Retention deletes stay allowed
-- because the fence trigger fires on UPDATE only (structural; the sweep
-- deletes by expiry without updating).
DO $$
BEGIN
  BEGIN
    UPDATE public.mcp_guest_carts SET items = '[]'::jsonb
    WHERE token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    RAISE EXCEPTION 'fenced legacy update must fail';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END
$$;

-- 9. UCP migration fences by cart handle and updated_at.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-ucp-1","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_updated text;
  v_result jsonb;
BEGIN
  SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') INTO v_updated
  FROM public.agentic_cart_sessions WHERE cart_id = 'ucp-cart-legacy-001';
  v_result := public.commerce_cart_migrate_legacy(
    'ucp', 'bccca6035f3bd26541d2daa456df5e81ad99d3529c2d325944e1ad7bc11c2335',
    'mig-ucp-1',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":3}]'::jsonb,
    v_updated, 'NGN'
  );
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'ucp migration must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'quantity')::integer <> 3 THEN
    RAISE EXCEPTION 'ucp migration must preserve quantity';
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_fenced uuid;
BEGIN
  SELECT migrated_to_cart_id INTO v_fenced FROM public.agentic_cart_sessions WHERE cart_id = 'ucp-cart-legacy-001';
  IF v_fenced IS NULL THEN RAISE EXCEPTION 'ucp row must be fenced'; END IF;
  BEGIN
    UPDATE public.agentic_cart_sessions SET cart_items = '[]'::jsonb WHERE cart_id = 'ucp-cart-legacy-001';
    RAISE EXCEPTION 'fenced ucp update must fail';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END
$$;

-- 10. UCP stale handles refresh; unknown handles report not_found.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-ucp-2","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.commerce_cart_migrate_legacy(
    'ucp', '416b1208fc1508eddda8b7edfea42709439d94b2e0719f796eab58559a800a95',
    'mig-ucp-2',
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1}]'::jsonb,
    '2000-01-01T00:00:00.000000Z', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'refresh_required' THEN
    RAISE EXCEPTION 'stale ucp handle must refresh, got %', v_result;
  END IF;
  v_result := public.commerce_cart_migrate_legacy(
    'ucp', '0000000000000000000000000000000000000000000000000000000000000000',
    'mig-ucp-3', '[]'::jsonb, '2000-01-01T00:00:00.000000Z', 'NGN'
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'not_found' THEN
    RAISE EXCEPTION 'unknown ucp handle must report not_found, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 11. The fence lookup returns the canonical mapping for migrated tokens.
DO $$
DECLARE
  v_mapped uuid;
  v_expected uuid;
BEGIN
  SELECT cart_id INTO v_expected FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND provider = 'mcp'
    AND legacy_hash = 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb';
  SELECT migrated_to_cart_id INTO v_mapped
  FROM public.get_mcp_guest_cart_migration('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  IF v_mapped IS NULL OR v_mapped <> v_expected THEN
    RAISE EXCEPTION 'fence lookup must return the canonical cart';
  END IF;
  SELECT migrated_to_cart_id INTO v_mapped
  FROM public.get_mcp_guest_cart_migration('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  IF v_mapped IS NOT NULL THEN RAISE EXCEPTION 'unmigrated token must map to null'; END IF;
END
$$;

ROLLBACK;
