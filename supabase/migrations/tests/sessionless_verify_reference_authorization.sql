-- =============================================
-- REGRESSION TEST: sessionless verify Bearer authorization
--   POST /api/payments/verify accepts mobile Bearer [REDACTED] (no CSRF
--   token), so the header alone proves nothing: the reference must be
--   bound to the caller before verification runs. The Bearer lane uses
--   authorize_sessionless_verify_reference() on the bearer-scoped client
--   (no service role): the reference's transaction must belong to an
--   order whose customer record is owned by auth.uid(). Every denial
--   returns NULL (no existence oracle).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/sessionless_verify_reference_authorization.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000241';
  v_mine_customer_id uuid := '9f000000-0000-4000-8000-000000000242';
  v_theirs_customer_id uuid := '9f000000-0000-4000-8000-000000000243';
  v_mine_order_id uuid := '9f000000-0000-4000-8000-000000000244';
  v_theirs_order_id uuid := '9f000000-0000-4000-8000-000000000245';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'verify-auth-regression@example.com',
    'Verify Auth Regression',
    'verify-auth-regression'
  );
  INSERT INTO public.customers (id, user_id)
  VALUES
    (v_mine_customer_id, '9f000000-0000-4000-8000-000000000249'),
    (v_theirs_customer_id, '9f000000-0000-4000-8000-000000000248');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_id)
  VALUES
    (v_mine_order_id, v_merchant_id, 'VERIFY-AUTH-001', 1000, v_mine_customer_id),
    (v_theirs_order_id, v_merchant_id, 'VERIFY-AUTH-002', 1000, v_theirs_customer_id);
  INSERT INTO public.transactions (
    id, merchant_id, transaction_type, amount, currency, order_id,
    gateway_reference
  )
  VALUES
    (
      '9f000000-0000-4000-8000-000000000246', v_merchant_id, 'payment',
      1000, 'NGN', v_mine_order_id, 'VERIFY-AUTH-MINE'
    ),
    (
      '9f000000-0000-4000-8000-000000000247', v_merchant_id, 'payment',
      1000, 'NGN', v_theirs_order_id, 'VERIFY-AUTH-THEIRS'
    );
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000249', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '9f000000-0000-4000-8000-000000000249'
  )::text,
  true
);

DO $$
DECLARE
  v_order_id uuid;
BEGIN
  -- Own reference authorizes to its order.
  SELECT public.authorize_sessionless_verify_reference('VERIFY-AUTH-MINE')
  INTO v_order_id;
  ASSERT v_order_id = '9f000000-0000-4000-8000-000000000244',
    'own reference must authorize to its order';

  -- Someone else's valid reference denies uniformly (no oracle).
  SELECT public.authorize_sessionless_verify_reference('VERIFY-AUTH-THEIRS')
  INTO v_order_id;
  ASSERT v_order_id IS NULL, 'foreign reference must deny';

  -- A bogus reference denies identically.
  SELECT public.authorize_sessionless_verify_reference('VERIFY-AUTH-BOGUS')
  INTO v_order_id;
  ASSERT v_order_id IS NULL, 'bogus reference must deny';

  -- Authenticated (bearer) callers hold EXECUTE; anon must not: without
  -- a user session there is no ownership to prove.
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.authorize_sessionless_verify_reference(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute authorize_sessionless_verify_reference(text)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.authorize_sessionless_verify_reference(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute authorize_sessionless_verify_reference(text)';
  END IF;
END;
$$;

ROLLBACK;
