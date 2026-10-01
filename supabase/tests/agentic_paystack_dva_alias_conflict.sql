-- REGRESSION TEST: active agentic checkout sessions cannot reserve a Paystack
-- receiver already held by another merchant's checkout session.
--
-- USAGE:
--   supabase test db supabase/tests/agentic_paystack_dva_alias_conflict.sql

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_first_merchant_id uuid := '3d7a2000-0000-4000-8000-000000000001';
  v_second_merchant_id uuid := '3d7a2000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_first_merchant_id, 'agentic-first@example.test', 'Agentic First', 'agentic-first'),
    (v_second_merchant_id, 'agentic-second@example.test', 'Agentic Second', 'agentic-second');

  INSERT INTO public.checkout_sessions (
    id, session_id, merchant_id, payment_provider, status,
    virtual_account_number, virtual_account_expires_at, expires_at
  ) VALUES (
    '3d7a2100-0000-4000-8000-000000000001', 'agentic-session-first',
    v_first_merchant_id, 'paystack', 'pending', '9876543210',
    pg_catalog.now() + pg_catalog.make_interval(mins => 30),
    pg_catalog.now() + pg_catalog.make_interval(hours => 1)
  );
END;
$fixtures$;

DO $conflict$
DECLARE
  v_conflict boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.checkout_sessions (
      id, session_id, merchant_id, payment_provider, status,
      virtual_account_number, virtual_account_expires_at, expires_at
    ) VALUES (
      '3d7a2100-0000-4000-8000-000000000002', 'agentic-session-second',
      '3d7a2000-0000-4000-8000-000000000002', 'paystack', 'processing',
      '9876543210',
      pg_catalog.now() + pg_catalog.make_interval(mins => 30),
      pg_catalog.now() + pg_catalog.make_interval(hours => 1)
    );
  EXCEPTION WHEN raise_exception THEN
    v_conflict := SQLSTATE = 'P0001'
      AND SQLERRM = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END;

  IF NOT v_conflict THEN
    RAISE EXCEPTION
      'cross-merchant active checkout receiver reservation was not rejected';
  END IF;
END;
$conflict$;

ROLLBACK;
