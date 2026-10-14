-- REGRESSION TEST: shared cart handoff grants, redemption and merge.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55434 -U postgres \
--     -d cart_hand -f supabase/tests/commerce_cart_handoff.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

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
\ir ../migrations/20261012050500_commerce_cart_handoff.sql

INSERT INTO public.merchants (id, slug) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ogabassey'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'second-store');

INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 250.00, 'active', 10, 10, true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 15.00, 'active', 10, 10, true),
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 320.00, 'active', 10, 10, true),
  ('66666666-6666-4666-8666-666666666666', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 9.00, 'active', 10, 10, true);

-- Origin (incoming) cart with charger + camera; destination cart with Tecno.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'NGN', 3, 'active', now() + interval '7 days'),
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'NGN', 2, 'active', now() + interval '7 days'),
  ('88888888-8888-4888-8888-888888888888', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 1, 1500),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', 1, 32000),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', 1, 25000);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-origin', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', 'guest-dest', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999993', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', 'guest-third', now() + interval '7 days', NULL),
  ('99999999-9999-4999-8999-999999999994', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-stale', now() - interval '1 hour', NULL),
  ('99999999-9999-4999-8999-999999999995', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'guest-foreign', now() + interval '7 days', NULL);

-- 1. Issue creates a pending five-minute grant keyed by hash only.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-1',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
  IF (v_result ->> 'replayed')::boolean THEN RAISE EXCEPTION 'fresh issue must not replay, got %', v_result; END IF;
  IF (v_result -> 'handoff' ->> 'id') <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'issue must return the handoff id, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_handoffs
  WHERE handoff_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    AND merchant_id = '11111111-1111-4111-8111-111111111111'
    AND source_cart_id = '22222222-2222-4222-8222-222222222222'
    AND redeemed_at IS NULL
    AND expires_at > now() + interval '4 minutes'
    AND expires_at <= now() + interval '5 minutes';
  IF v_count <> 1 THEN RAISE EXCEPTION 'grant row must be pending with a five-minute expiry'; END IF;
END
$$;

-- 2. Issue replay converges on the same row without extending expiry.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_count integer;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-1',
    '{"type":"web"}'::jsonb
  ) INTO v_replay;
  IF NOT (v_replay ->> 'ok')::boolean THEN RAISE EXCEPTION 'replay must succeed, got %', v_replay; END IF;
  IF NOT (v_replay ->> 'replayed')::boolean THEN RAISE EXCEPTION 'replay must flag replayed, got %', v_replay; END IF;
  IF (v_replay -> 'handoff' ->> 'id') <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'replay must return the original handoff id, got %', v_replay;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.commerce_cart_handoffs
  WHERE handoff_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  IF v_count <> 1 THEN RAISE EXCEPTION 'replay must not mint a second grant'; END IF;
END
$$;
RESET ROLE;

-- 3. Issue rejects foreign carts, expired grants and bootstrap callers.
SET request.jwt.claims = '{"cart_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cart_principal_id":"guest-foreign","cart_scope":"session","cart_id":"88888888-8888-4888-8888-888888888888","cart_grant_id":"99999999-9999-4999-8999-999999999995"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-x',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'foreign cart issue must be unauthorized, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-stale","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999994"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-y',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'expired' THEN
    RAISE EXCEPTION 'expired-grant issue must report expired, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-new","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-z',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'bootstrap issue must be unauthorized, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 4. Preview returns the pending snapshot and merchant without consuming.
SET ROLE anon;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_preview_handoff('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'preview must succeed, got %', v_result; END IF;
  IF (v_result ->> 'status') <> 'pending' THEN RAISE EXCEPTION 'preview must report pending, got %', v_result; END IF;
  IF (v_result -> 'merchant' ->> 'slug') <> 'ogabassey' THEN
    RAISE EXCEPTION 'preview must name the merchant, got %', v_result;
  END IF;
  IF (v_result -> 'snapshot' ->> 'version')::integer <> 3 THEN
    RAISE EXCEPTION 'preview must carry the incoming version, got %', v_result;
  END IF;
  IF jsonb_array_length(v_result -> 'snapshot' -> 'lines') <> 2 THEN
    RAISE EXCEPTION 'preview must carry incoming lines, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_handoffs
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND redeemed_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'preview must never consume the grant'; END IF;
END
$$;

-- 5. Preview reports unknown links distinctly from live ones.
SET ROLE anon;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_preview_handoff('99999999-9999-4999-8999-999999999999') INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'not_found' THEN
    RAISE EXCEPTION 'unknown preview must be not_found, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 6. Connect binds a fresh destination to the incoming cart exactly once.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_replay jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attempt-1', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'connect must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'cartId') <> '22222222-2222-4222-8222-222222222222' THEN
    RAISE EXCEPTION 'connect must return the incoming cart, got %', v_result;
  END IF;
  IF (v_result ->> 'grantId') IS NULL THEN RAISE EXCEPTION 'connect must mint a destination grant, got %', v_result; END IF;

  SELECT public.commerce_cart_redeem_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attempt-1', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_replay;
  IF NOT (v_replay ->> 'ok')::boolean OR NOT (v_replay ->> 'replayed')::boolean THEN
    RAISE EXCEPTION 'same-attempt retry must replay, got %', v_replay;
  END IF;
  IF (v_replay ->> 'grantId') <> (v_result ->> 'grantId') THEN
    RAISE EXCEPTION 'replay must return the original grant, got % then %', v_result, v_replay;
  END IF;

  SELECT public.commerce_cart_redeem_handoff(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'attempt-2', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_replay;
  IF (v_replay ->> 'ok')::boolean OR (v_replay ->> 'code') <> 'handoff_consumed' THEN
    RAISE EXCEPTION 'a different attempt must not reuse a consumed grant, got %', v_replay;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_grants
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND cart_id = '22222222-2222-4222-8222-222222222222'
    AND principal_id = 'guest-fresh';
  IF v_count <> 1 THEN RAISE EXCEPTION 'connect must create exactly one destination grant'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_cart_handoffs
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND redeemed_at IS NOT NULL
    AND destination_attempt_id = 'attempt-1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'connect must record the winning attempt'; END IF;
END
$$;

-- 7. Connect leaves an existing destination cart and linked grants intact.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-2',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"77777777-7777-4777-8777-777777777777","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'attempt-3', 'connect', 'web',
    '77777777-7777-4777-8777-777777777777', 3, 2, NULL, NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'connect must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'cartId') <> '22222222-2222-4222-8222-222222222222' THEN
    RAISE EXCEPTION 'connect must select the incoming cart, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_lines integer;
  v_version integer;
  v_grants integer;
BEGIN
  SELECT count(*) INTO v_lines FROM public.commerce_cart_lines
  WHERE cart_id = '77777777-7777-4777-8777-777777777777';
  SELECT version INTO v_version FROM public.commerce_carts WHERE id = '77777777-7777-4777-8777-777777777777';
  IF v_lines <> 1 OR v_version <> 2 THEN RAISE EXCEPTION 'connect must not touch the destination cart'; END IF;
  SELECT count(*) INTO v_grants FROM public.commerce_cart_grants
  WHERE cart_id = '77777777-7777-4777-8777-777777777777' AND revoked_at IS NULL;
  IF v_grants <> 2 THEN RAISE EXCEPTION 'linked grants must survive connect'; END IF;
END
$$;

-- 8. Explicit merge combines the Tecno baseline with charger/camera lines.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-3',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"77777777-7777-4777-8777-777777777777","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'attempt-4', 'merge', 'web',
    '77777777-7777-4777-8777-777777777777', 3, 2,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1},{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1},{"item":{"productId":"55555555-5555-4555-8555-555555555555"},"quantity":1}]'::jsonb,
    NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'merge must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'version')::integer <> 3 THEN
    RAISE EXCEPTION 'merge must bump the destination version, got %', v_result;
  END IF;
  IF jsonb_array_length(v_result -> 'state' -> 'lines') <> 3 THEN
    RAISE EXCEPTION 'merge must union all lines, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_incoming integer;
BEGIN
  SELECT count(*) INTO v_incoming FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222';
  IF v_incoming <> 2 THEN RAISE EXCEPTION 'merge must leave the incoming cart intact'; END IF;
  SELECT count(*) INTO v_incoming FROM public.commerce_cart_events
  WHERE cart_id = '77777777-7777-4777-8777-777777777777' AND version = 3;
  IF v_incoming <> 1 THEN RAISE EXCEPTION 'merge must publish a cart event for the destination version'; END IF;
END
$$;

-- 9. Same-line quantities use max and repeated import does not increment.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('10101010-1010-4101-8101-101010101010', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('20202020-2020-4202-8202-202020202020', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('11111111-1111-4111-8111-111111111111', '10101010-1010-4101-8101-101010101010', '33333333-3333-4333-8333-333333333333', 3, 25000),
  ('11111111-1111-4111-8111-111111111111', '20202020-2020-4202-8202-202020202020', '33333333-3333-4333-8333-333333333333', 1, 25000);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('10101010-0000-4000-8000-101010101010', '11111111-1111-4111-8111-111111111111', '10101010-1010-4101-8101-101010101010', 'guest-origin', now() + interval '7 days', NULL),
  ('20202020-0000-4000-8000-202020202020', '11111111-1111-4111-8111-111111111111', '20202020-2020-4202-8202-202020202020', 'guest-dest', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"10101010-1010-4101-8101-101010101010","cart_grant_id":"10101010-0000-4000-8000-101010101010"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '1111111111111111111111111111111111111111111111111111111111111111',
    '11111111-1111-4111-8111-111111111111',
    '10101010-1010-4101-8101-101010101010',
    'handoff-op-max-1',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"20202020-2020-4202-8202-202020202020","cart_grant_id":"20202020-0000-4000-8000-202020202020"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '1111111111111111111111111111111111111111111111111111111111111111',
    '11111111-1111-4111-8111-111111111111',
    'attempt-max-1', 'merge', 'web',
    '20202020-2020-4202-8202-202020202020', 1, 1,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":3}]'::jsonb,
    NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'max merge must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'quantity')::integer <> 3 THEN
    RAISE EXCEPTION 'merge must take the max quantity, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"10101010-1010-4101-8101-101010101010","cart_grant_id":"10101010-0000-4000-8000-101010101010"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '2222222222222222222222222222222222222222222222222222222222222222',
    '22222222-2222-4222-8222-222222222222',
    '10101010-1010-4101-8101-101010101010',
    'handoff-op-max-2',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'second issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"20202020-2020-4202-8202-202020202020","cart_grant_id":"20202020-0000-4000-8000-202020202020"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '2222222222222222222222222222222222222222222222222222222222222222',
    '22222222-2222-4222-8222-222222222222',
    'attempt-max-2', 'merge', 'web',
    '20202020-2020-4202-8202-202020202020', 1, 2,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":3}]'::jsonb,
    NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 're-import must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'quantity')::integer <> 3 THEN
    RAISE EXCEPTION 'repeated import must not increment, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 10. Conflicting negotiation and voucher contexts require an explicit choice.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('30303030-3030-4303-8303-303030303030', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('40404040-4040-4404-8404-404040404040', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, negotiated_unit_price_minor, negotiation_status, last_unit_price_minor) VALUES
  ('11111111-1111-4111-8111-111111111111', '30303030-3030-4303-8303-303030303030', '33333333-3333-4333-8333-333333333333', 1, 20000, 'accepted', 25000),
  ('11111111-1111-4111-8111-111111111111', '40404040-4040-4404-8404-404040404040', '33333333-3333-4333-8333-333333333333', 1, 22000, 'accepted', 25000);
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('30303030-0000-4000-8000-303030303030', '11111111-1111-4111-8111-111111111111', '30303030-3030-4303-8303-303030303030', 'guest-origin', now() + interval '7 days', NULL),
  ('40404040-0000-4000-8000-404040404040', '11111111-1111-4111-8111-111111111111', '40404040-4040-4404-8404-404040404040', 'guest-dest', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"30303030-3030-4303-8303-303030303030","cart_grant_id":"30303030-0000-4000-8000-303030303030"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '3333333333333333333333333333333333333333333333333333333333333333',
    '33333333-3333-4333-8333-333333333333',
    '30303030-3030-4303-8303-303030303030',
    'handoff-op-neg',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"40404040-4040-4404-8404-404040404040","cart_grant_id":"40404040-0000-4000-8000-404040404040"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '3333333333333333333333333333333333333333333333333333333333333333',
    '33333333-3333-4333-8333-333333333333',
    'attempt-neg', 'merge', 'web',
    '40404040-4040-4404-8404-404040404040', 1, 1,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1,"negotiatedUnitPriceMinor":20000,"negotiationStatus":"accepted"}]'::jsonb,
    NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'merge_conflict' THEN
    RAISE EXCEPTION 'unresolved negotiation must conflict, got %', v_result;
  END IF;
  IF jsonb_array_length(v_result -> 'conflicts') <> 1 THEN
    RAISE EXCEPTION 'conflict must name the line, got %', v_result;
  END IF;

  SELECT public.commerce_cart_redeem_handoff(
    '3333333333333333333333333333333333333333333333333333333333333333',
    '33333333-3333-4333-8333-333333333333',
    'attempt-neg', 'merge', 'web',
    '40404040-4040-4404-8404-404040404040', 1, 1,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1,"negotiatedUnitPriceMinor":20000,"negotiationStatus":"accepted"}]'::jsonb,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"keep":"incoming"}]'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'resolved merge must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' -> 'lines' -> 0 ->> 'negotiatedUnitPriceMinor')::integer <> 20000 THEN
    RAISE EXCEPTION 'merge must keep the chosen negotiation, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 11. Merges beyond the line cap fail atomically.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('50505050-5050-4505-8505-505050505050', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days'),
  ('60606060-6060-4606-8606-606060606060', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
DO $$
DECLARE
  i integer;
  v_product uuid;
BEGIN
  FOR i IN 1..21 LOOP
    v_product := gen_random_uuid();
    INSERT INTO public.products (id, merchant_id, price, status, stock_quantity, stock, manage_stock)
    VALUES (v_product, '11111111-1111-4111-8111-111111111111', 1.00, 'active', 10, 10, true);
    IF i <= 20 THEN
      INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
      VALUES ('11111111-1111-4111-8111-111111111111', '60606060-6060-4606-8606-606060606060', v_product, 1, 100);
    ELSE
      INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
      VALUES ('11111111-1111-4111-8111-111111111111', '50505050-5050-4505-8505-505050505050', v_product, 1, 100);
    END IF;
  END LOOP;
END
$$;
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('50505050-0000-4000-8000-505050505050', '11111111-1111-4111-8111-111111111111', '50505050-5050-4505-8505-505050505050', 'guest-origin', now() + interval '7 days', NULL),
  ('60606060-0000-4000-8000-606060606060', '11111111-1111-4111-8111-111111111111', '60606060-6060-4606-8606-606060606060', 'guest-dest', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"50505050-5050-4505-8505-505050505050","cart_grant_id":"50505050-0000-4000-8000-505050505050"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '4444444444444444444444444444444444444444444444444444444444444444',
    '44444444-4444-4444-8444-444444444444',
    '50505050-5050-4505-8505-505050505050',
    'handoff-op-cap',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
CREATE TEMPORARY TABLE cap_lines AS
SELECT jsonb_agg(jsonb_build_object('item', jsonb_build_object('productId', l.product_id), 'quantity', 1)) AS payload
FROM public.commerce_cart_lines l
WHERE l.cart_id IN ('50505050-5050-4505-8505-505050505050', '60606060-6060-4606-8606-606060606060');
GRANT SELECT ON cap_lines TO commerce_cart_shopper;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"60606060-6060-4606-8606-606060606060","cart_grant_id":"60606060-0000-4000-8000-606060606060"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
  v_lines jsonb;
BEGIN
  SELECT payload INTO v_lines FROM cap_lines;
  IF jsonb_array_length(v_lines) <> 21 THEN
    RAISE EXCEPTION 'fixture must submit 21 lines, got %', jsonb_array_length(v_lines);
  END IF;
  SELECT public.commerce_cart_redeem_handoff(
    '4444444444444444444444444444444444444444444444444444444444444444',
    '44444444-4444-4444-8444-444444444444',
    'attempt-cap', 'merge', 'web',
    '60606060-6060-4606-8606-606060606060', 1, 1,
    v_lines,
    NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'invalid_item' THEN
    RAISE EXCEPTION 'over-cap merge must be invalid_item, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_lines integer;
  v_version integer;
BEGIN
  SELECT count(*) INTO v_lines FROM public.commerce_cart_lines
  WHERE cart_id = '60606060-6060-4606-8606-606060606060';
  SELECT version INTO v_version FROM public.commerce_carts WHERE id = '60606060-6060-4606-8606-606060606060';
  IF v_lines <> 20 OR v_version <> 1 THEN RAISE EXCEPTION 'failed merge must apply nothing'; END IF;
END
$$;

-- 12. Stale versions fail without consuming, then retry cleanly.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"10101010-1010-4101-8101-101010101010","cart_grant_id":"10101010-0000-4000-8000-101010101010"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '5555555555555555555555555555555555555555555555555555555555555555',
    '55555555-5555-4555-8555-555555555555',
    '10101010-1010-4101-8101-101010101010',
    'handoff-op-stale',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"20202020-2020-4202-8202-202020202020","cart_grant_id":"20202020-0000-4000-8000-202020202020"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '5555555555555555555555555555555555555555555555555555555555555555',
    '55555555-5555-4555-8555-555555555555',
    'attempt-stale', 'merge', 'web',
    '20202020-2020-4202-8202-202020202020', 1, 2,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":3}]'::jsonb,
    NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'version_conflict' THEN
    RAISE EXCEPTION 'stale versions must conflict, got %', v_result;
  END IF;
  IF (v_result ->> 'destVersion')::integer <> 3 THEN
    RAISE EXCEPTION 'conflict must report the live destination version, got %', v_result;
  END IF;

  SELECT public.commerce_cart_redeem_handoff(
    '5555555555555555555555555555555555555555555555555555555555555555',
    '55555555-5555-4555-8555-555555555555',
    'attempt-stale', 'merge', 'web',
    '20202020-2020-4202-8202-202020202020', 1, 3,
    '[{"item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":3}]'::jsonb,
    NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'fresh retry must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;

-- 13. Carts locked for checkout refuse connect and merge.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('70707070-7070-4707-8707-707070707070', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'checkout', now() + interval '7 days');
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('70707070-0000-4000-8000-707070707070', '11111111-1111-4111-8111-111111111111', '70707070-7070-4707-8707-707070707070', 'guest-origin', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"70707070-7070-4707-8707-707070707070","cart_grant_id":"70707070-0000-4000-8000-707070707070"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '6666666666666666666666666666666666666666666666666666666666666666',
    '66666666-6666-4666-8666-666666666666',
    '70707070-7070-4707-8707-707070707070',
    'handoff-op-locked',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '6666666666666666666666666666666666666666666666666666666666666666',
    '66666666-6666-4666-8666-666666666666',
    'attempt-locked', 'connect', 'web', NULL, 1, NULL, NULL, NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'cart_locked' THEN
    RAISE EXCEPTION 'connect to a checkout cart must lock, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 14. Keep-existing consumes the link while leaving both carts intact.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '7777777777777777777777777777777777777777777777777777777777777777',
    '77777777-7777-4777-8777-777777777777',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-keep',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-dest","cart_scope":"session","cart_id":"77777777-7777-4777-8777-777777777777","cart_grant_id":"99999999-9999-4999-8999-999999999992"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '7777777777777777777777777777777777777777777777777777777777777777',
    '77777777-7777-4777-8777-777777777777',
    'attempt-keep', 'keep_existing', 'web',
    '77777777-7777-4777-8777-777777777777', 3, 3, NULL, NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'keep_existing must succeed, got %', v_result; END IF;
  IF (v_result -> 'state' ->> 'cartId') <> '77777777-7777-4777-8777-777777777777' THEN
    RAISE EXCEPTION 'keep_existing must keep the destination cart, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_dest_lines integer;
  v_dest_version integer;
  v_incoming_lines integer;
  v_redeemed integer;
BEGIN
  SELECT count(*) INTO v_dest_lines FROM public.commerce_cart_lines
  WHERE cart_id = '77777777-7777-4777-8777-777777777777';
  SELECT version INTO v_dest_version FROM public.commerce_carts WHERE id = '77777777-7777-4777-8777-777777777777';
  SELECT count(*) INTO v_incoming_lines FROM public.commerce_cart_lines
  WHERE cart_id = '22222222-2222-4222-8222-222222222222';
  SELECT count(*) INTO v_redeemed FROM public.commerce_cart_handoffs
  WHERE id = '77777777-7777-4777-8777-777777777777' AND redeemed_at IS NOT NULL;
  IF v_dest_lines <> 3 OR v_dest_version <> 3 THEN RAISE EXCEPTION 'destination cart must be untouched'; END IF;
  IF v_incoming_lines <> 2 THEN RAISE EXCEPTION 'incoming cart must be untouched'; END IF;
  IF v_redeemed <> 1 THEN RAISE EXCEPTION 'keep_existing must still consume the single-use link'; END IF;
END
$$;

-- 15. Expiry blocks fresh attempts but committed receipts still recover.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '8888888888888888888888888888888888888888888888888888888888888888',
    '88888888-8888-4888-8888-888888888888',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-expire',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '8888888888888888888888888888888888888888888888888888888888888888',
    '88888888-8888-4888-8888-888888888888',
    'attempt-expire', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'connect must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
UPDATE public.commerce_cart_handoffs SET expires_at = now() - interval '1 minute'
WHERE id = '88888888-8888-4888-8888-888888888888';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '8888888888888888888888888888888888888888888888888888888888888888',
    '88888888-8888-4888-8888-888888888888',
    'attempt-expire', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean OR NOT (v_result ->> 'replayed')::boolean THEN
    RAISE EXCEPTION 'bound destination must recover after expiry, got %', v_result;
  END IF;
  SELECT public.commerce_cart_redeem_handoff(
    '8888888888888888888888888888888888888888888888888888888888888888',
    '88888888-8888-4888-8888-888888888888',
    'attempt-expire-new', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'handoff_consumed' THEN
    RAISE EXCEPTION 'a new attempt on a used link must fail, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    '9999999999999999999999999999999999999999999999999999999999999999',
    '99999999-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-expire-2',
    '{"type":"web"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'issue must succeed, got %', v_result; END IF;
END
$$;
RESET ROLE;
UPDATE public.commerce_cart_handoffs SET expires_at = now() - interval '1 minute'
WHERE id = '99999999-1111-4111-8111-111111111111';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '9999999999999999999999999999999999999999999999999999999999999999',
    '99999999-1111-4111-8111-111111111111',
    'attempt-expire-fresh', 'connect', 'web', NULL, 3, NULL, NULL, NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'expired' THEN
    RAISE EXCEPTION 'fresh attempt on an expired link must report expired, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 16. Foreign merchants and mismatched destinations cannot redeem.
SET request.jwt.claims = '{"cart_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cart_principal_id":"guest-foreign","cart_scope":"session","cart_id":"88888888-8888-4888-8888-888888888888","cart_grant_id":"99999999-9999-4999-8999-999999999995"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '6666666666666666666666666666666666666666666666666666666666666666',
    '66666666-6666-4666-8666-666666666666',
    'attempt-foreign', 'connect', 'web', NULL, 1, NULL, NULL, NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'foreign merchant redeem must be unauthorized, got %', v_result;
  END IF;
END
$$;
RESET ROLE;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-fresh","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_redeem_handoff(
    '6666666666666666666666666666666666666666666666666666666666666666',
    '66666666-6666-4666-8666-666666666666',
    'attempt-nativemismatch', 'connect', 'native', NULL, 1, NULL, NULL, NULL
  ) INTO v_result;
  IF (v_result ->> 'ok')::boolean OR (v_result ->> 'code') <> 'unauthorized' THEN
    RAISE EXCEPTION 'destination mismatch must be unauthorized, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 17. Third-party linked grants keep working after a merge.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-third","cart_scope":"session","cart_id":"77777777-7777-4777-8777-777777777777","cart_grant_id":"99999999-9999-4999-8999-999999999993"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.commerce_cart_snapshot('77777777-7777-4777-8777-777777777777') INTO v_result;
  IF NOT (v_result ->> 'ok')::boolean THEN RAISE EXCEPTION 'linked grant must still read, got %', v_result; END IF;
  IF jsonb_array_length(v_result -> 'state' -> 'lines') <> 3 THEN
    RAISE EXCEPTION 'linked grant must see merged lines, got %', v_result;
  END IF;
  SELECT public.commerce_cart_mutate(
    '77777777-7777-4777-8777-777777777777', 'op-third-after-merge', 3,
    '{"type":"set_quantity","lineId":"x","quantity":1}'::jsonb
  ) INTO v_result;
  IF (v_result ->> 'code') = 'unauthorized' OR (v_result ->> 'code') = 'expired' THEN
    RAISE EXCEPTION 'linked grant must still mutate, got %', v_result;
  END IF;
END
$$;
RESET ROLE;

-- 18. Same operation key with a different body conflicts instead of minting.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-origin","cart_scope":"session","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"99999999-9999-4999-8999-999999999991"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
BEGIN
  SELECT public.commerce_cart_issue_handoff(
    'dbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdb',
    'dbdbdbdb-dbdb-4dbd-8dbd-dbdbdbdbdbdb',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-18',
    '{"type":"web"}'::jsonb
  ) INTO v_first;
  IF NOT (v_first ->> 'ok')::boolean THEN RAISE EXCEPTION 'fresh issue must succeed, got %', v_first; END IF;
  IF (v_first ->> 'replayed')::boolean THEN RAISE EXCEPTION 'fresh issue must not replay, got %', v_first; END IF;
  SELECT public.commerce_cart_issue_handoff(
    'dbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdb',
    'dbdbdbdb-dbdb-4dbd-8dbd-dbdbdbdbdbde',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-18',
    '{"type":"web"}'::jsonb
  ) INTO v_replay;
  IF NOT (v_replay ->> 'ok')::boolean OR NOT (v_replay ->> 'replayed')::boolean THEN
    RAISE EXCEPTION 'same key with the same body must replay, got %', v_replay;
  END IF;
  SELECT public.commerce_cart_issue_handoff(
    'bdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbd',
    'bdbdbdbd-bdbd-4bdb-8bdb-bdbdbdbdbdbd',
    '22222222-2222-4222-8222-222222222222',
    'handoff-op-18',
    '{"type":"native","app":"storefront"}'::jsonb
  ) INTO v_conflict;
  IF (v_conflict ->> 'ok')::boolean OR (v_conflict ->> 'code') <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'same key with a different body must conflict, got %', v_conflict;
  END IF;
END
$$;
RESET ROLE;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_cart_handoffs
  WHERE operation_id = 'handoff-op-18';
  IF v_count <> 1 THEN RAISE EXCEPTION 'conflicting issue must not mint a second grant'; END IF;
END
$$;

ROLLBACK;
