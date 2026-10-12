-- REGRESSION TEST: shared server cart tenant/guest isolation.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55433 -U postgres \
--     -d cart_test -f supabase/tests/commerce_cart_access.sql
--
-- Proves, with real roles and separate sessions, that only the dedicated
-- shopper role with a matching merchant/cart/grant claim can touch its own
-- cart rows, and that anon/authenticated/receiver roles plus forged,
-- expired or revoked claims are denied.

\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- Unrelated private tables: the cart roles must never read these.
CREATE TABLE public.customers (id uuid PRIMARY KEY, email text);
CREATE TABLE public.orders (id uuid PRIMARY KEY, total_minor integer);
INSERT INTO public.customers VALUES ('99999999-9999-4999-8999-999999999999', 'shopper@example.com');
INSERT INTO public.orders VALUES ('88888888-8888-4888-8888-888888888888', 5000);

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql

-- Fixtures: merchants A/B, carts A1/A2/B1, guests A1/A2/B1.
INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() + interval '7 days');

INSERT INTO public.commerce_cart_lines (merchant_id, cart_id, product_id, quantity) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 2),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '55555555-5555-4555-8555-555555555555', 1);

INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '7 days', NULL),
  ('66666666-6666-4666-8666-666666666667', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1-old', now() - interval '1 hour', NULL),
  ('66666666-6666-4666-8666-666666666668', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1-rev', now() + interval '7 days', now()),
  ('66666666-6666-4666-8666-666666666669', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222223', 'guest-a2', now() + interval '7 days', NULL),
  ('77777777-7777-4777-8777-777777777777', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'guest-b1', now() + interval '7 days', NULL);

INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 2, 'op-1', now() + interval '1 day');

INSERT INTO public.commerce_cart_operations (merchant_id, cart_id, principal_id, operation_id, request_digest, expires_at) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', 'op-live', 'digest-live', now() + interval '1 day'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', 'op-stale', 'digest-stale', now() - interval '1 hour');

-- 1. Shopper A1 reads exactly its own cart, lines and grant.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
  v_lines integer;
  v_grants integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 1 THEN RAISE EXCEPTION 'shopper must read exactly its own cart, got %', v_carts; END IF;
  SELECT count(*) INTO v_lines FROM public.commerce_cart_lines;
  IF v_lines <> 2 THEN RAISE EXCEPTION 'shopper must read exactly its own lines, got %', v_lines; END IF;
  SELECT count(*) INTO v_grants FROM public.commerce_cart_grants;
  IF v_grants <> 1 THEN RAISE EXCEPTION 'shopper must read exactly its own grant, got %', v_grants; END IF;
END
$$;
RESET ROLE;

-- 2. Wrong merchant claim reads nothing.
SET request.jwt.claims = '{"cart_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'wrong-merchant claim must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 3. Forged grant (grant of cart A1 presented for cart A2) reads nothing.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222223","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'forged grant claim must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 4. Forged subject (wrong principal for a live grant) reads nothing.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-impostor","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'forged subject must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 5. Expired grant reads nothing.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666667","cart_principal_id":"guest-a1-old","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'expired grant must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 6. Revoked grant reads nothing.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666668","cart_principal_id":"guest-a1-rev","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'revoked grant must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 7. Missing claims read nothing.
RESET request.jwt.claims;
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'missing claims must read no carts, got %', v_carts; END IF;
END
$$;
RESET ROLE;

-- 8. Ordinary anon/authenticated roles read nothing and cannot write.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.commerce_carts;
    RAISE EXCEPTION 'anon select must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_carts (merchant_id, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', now() + interval '7 days');
    RAISE EXCEPTION 'anon insert must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.cleanup_commerce_carts();
    RAISE EXCEPTION 'anon cleanup execute must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.commerce_carts;
    RAISE EXCEPTION 'authenticated select must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_carts (merchant_id, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', now() + interval '7 days');
    RAISE EXCEPTION 'authenticated insert must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 9. Receive-only role cannot read or mutate cart tables.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_receiver;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.commerce_carts;
    RAISE EXCEPTION 'receiver select must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_carts (merchant_id, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', now() + interval '7 days');
    RAISE EXCEPTION 'receiver insert must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.commerce_carts SET version = version WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'receiver update must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 10. Session shopper cannot mint or widen grants, nor touch receipts.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.commerce_cart_grants (merchant_id, cart_id, principal_id, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '30 days');
    RAISE EXCEPTION 'shopper grant mint must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.commerce_cart_lines SET quantity = 9 WHERE cart_id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'shopper direct line update must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 11. Bootstrap scope creates under its own merchant/principal only, and
-- cannot read or attach an existing cart by ID.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-new","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE
  v_carts integer;
BEGIN
  SELECT count(*) INTO v_carts FROM public.commerce_carts;
  IF v_carts <> 0 THEN RAISE EXCEPTION 'bootstrap must read no existing carts, got %', v_carts; END IF;
  -- No RETURNING: bootstrap has no SELECT right by design; the Task 3
  -- creation RPC returns the new ID from inside its transaction.
  INSERT INTO public.commerce_carts (id, merchant_id, expires_at)
  VALUES ('99999999-9999-4999-8999-999999999998', '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
  INSERT INTO public.commerce_cart_creation_requests (merchant_id, principal_id, operation_id, request_digest, cart_id, expires_at)
  VALUES ('11111111-1111-4111-8111-111111111111', 'guest-new', 'create-1', 'digest-1', '99999999-9999-4999-8999-999999999998', now() + interval '1 day');
  BEGIN
    INSERT INTO public.commerce_carts (merchant_id, expires_at)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now() + interval '7 days');
    RAISE EXCEPTION 'bootstrap cross-merchant insert must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_cart_creation_requests (merchant_id, principal_id, operation_id, request_digest, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', 'guest-other', 'create-2', 'digest-2', now() + interval '1 day');
    RAISE EXCEPTION 'bootstrap foreign-principal receipt must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 12. Session scope cannot use the bootstrap creation path.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.commerce_carts (merchant_id, expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111', now() + interval '7 days');
    RAISE EXCEPTION 'session-scope cart insert must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 13. Cart roles cannot query unrelated private tables.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.customers;
    RAISE EXCEPTION 'shopper customer read must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.orders;
    RAISE EXCEPTION 'shopper order read must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

SET ROLE commerce_cart_receiver;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.customers;
    RAISE EXCEPTION 'receiver customer read must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 14. Worker leases events and runs bounded cleanup; shoppers cannot.
SET ROLE commerce_cart_worker;
DO $$
DECLARE
  v_events integer;
BEGIN
  SELECT count(*) INTO v_events FROM public.commerce_cart_events;
  IF v_events <> 1 THEN RAISE EXCEPTION 'worker must read the pending event, got %', v_events; END IF;
  UPDATE public.commerce_cart_events SET locked_at = now(), locked_by = 'test-worker', attempts = attempts + 1
  WHERE delivered_at IS NULL AND locked_at IS NULL;
  PERFORM public.cleanup_commerce_carts();
END
$$;
RESET ROLE;

DO $$
DECLARE
  v_ops integer;
BEGIN
  SELECT count(*) INTO v_ops FROM public.commerce_cart_operations WHERE operation_id = 'op-stale';
  IF v_ops <> 0 THEN RAISE EXCEPTION 'cleanup must delete the expired operation receipt'; END IF;
  SELECT count(*) INTO v_ops FROM public.commerce_cart_operations WHERE operation_id = 'op-live';
  IF v_ops <> 1 THEN RAISE EXCEPTION 'cleanup must retain the live operation receipt'; END IF;
END
$$;

SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"22222222-2222-4222-8222-222222222222","cart_grant_id":"66666666-6666-4666-8666-666666666666","cart_principal_id":"guest-a1","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
BEGIN
  BEGIN
    PERFORM public.cleanup_commerce_carts();
    RAISE EXCEPTION 'shopper cleanup execute must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- 15. Deleting a cart nulls only the receipt's cart reference.
DO $$
DECLARE
  v_receipt public.commerce_cart_creation_requests%ROWTYPE;
BEGIN
  DELETE FROM public.commerce_carts WHERE id = '99999999-9999-4999-8999-999999999998';
  SELECT * INTO v_receipt FROM public.commerce_cart_creation_requests
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND principal_id = 'guest-new' AND operation_id = 'create-1';
  IF NOT FOUND THEN RAISE EXCEPTION 'creation receipt must survive cart deletion'; END IF;
  IF v_receipt.cart_id IS NOT NULL THEN RAISE EXCEPTION 'receipt cart_id must null on cart deletion'; END IF;
  IF v_receipt.merchant_id <> '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'receipt merchant_id must survive cart deletion';
  END IF;
END
$$;

ROLLBACK;
