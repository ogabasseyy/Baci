-- REGRESSION TEST: completed-refund sweep branch coverage.
--
-- The sweep feeds record_verified_paystack_cancellation_refund_v1:
-- whatever it omits never re-verifies. BNPL-approved orders are
-- funded like paid ones, so their completed refunds must reselect
-- or the BNPL finalization path starves; legacy native refunds may
-- store status 'refunded' rather than 'completed', which the
-- transition accepts, so both terminal spellings must reselect.
-- Fixtures use the 9ef6 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_sweep_selection.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef60000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9ef60100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_owner_id, '00000000-0000-4000-8000-000000000000',
    'authenticated', 'authenticated', 'sweep-owner@example.test',
    'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
    '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (v_merchant_id, v_owner_id, 'sweep-owner@example.test',
    'Sweep Fixture', 'sweep-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef61000-0000-4000-8000-000000000001', v_merchant_id, 'SWEEP-001',
      100, 100, 'bnpl_approved', 'cancelled', pg_catalog.now()),
    ('9ef61000-0000-4000-8000-000000000002', v_merchant_id, 'SWEEP-002',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef62000-0000-4000-8000-000000000001', v_merchant_id,
      '9ef61000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'bnpl-cap-1', '{}'::jsonb),
    ('9ef62000-0000-4000-8000-000000000002', v_merchant_id,
      '9ef61000-0000-4000-8000-000000000001', 'refund', 100, 'NGN',
      'completed', 'paystack', '11', '{}'::jsonb),
    ('9ef62000-0000-4000-8000-000000000003', v_merchant_id,
      '9ef61000-0000-4000-8000-000000000002', 'payment', 100, 'NGN',
      'completed', 'paystack', 'leg-cap-2', '{}'::jsonb),
    ('9ef62000-0000-4000-8000-000000000004', v_merchant_id,
      '9ef61000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'refunded', 'paystack', '12', '{}'::jsonb),
    ('9ef62000-0000-4000-8000-000000000005', v_merchant_id,
      '9ef61000-0000-4000-8000-000000000002', 'refund', 100, 'NGN',
      'refund_pending', 'paystack', '13', '{}'::jsonb);
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_sweep_selection$
BEGIN
  -- A completed Paystack refund on a BNPL-approved order reselects:
  -- funded like paid, it needs the same re-verification.
  IF NOT EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = '9ef62000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'bnpl completed refund missing from sweep';
  END IF;
  -- A legacy native refund stored as 'refunded' reselects: the
  -- transition accepts any status, so the sweep must not hold the
  -- alternate terminal spelling out of polling.
  IF NOT EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = '9ef62000-0000-4000-8000-000000000004'
  ) THEN
    RAISE EXCEPTION 'legacy refunded row missing from sweep';
  END IF;
  -- In-flight rows stay out: the pending worker owns them.
  IF EXISTS (
    SELECT 1
    FROM public.select_completed_paystack_cancellation_refund_candidates_v1(
      25, pg_catalog.now(), 5)
    WHERE id = '9ef62000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'pending row leaked into sweep';
  END IF;
END;
$refund_sweep_selection$;

ROLLBACK;
