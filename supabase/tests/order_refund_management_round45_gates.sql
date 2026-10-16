-- REGRESSION TEST: movement-evidence and mid-claim coverage gates.
--
-- Covers unresolved-review vetoes with the failed-only escape and
-- mid-claim coverage polling. Retry gating split to
-- order_refund_management_retry_gating.sql per the 300-line
-- boundary; self-contained fixtures use the 9ef1 namespace and roll
-- back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round45_gates.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_label text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    ('9ef10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    ('9ef10000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000001', 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    ('9ef10100-0000-4000-8000-000000000002', '9ef10000-0000-4000-8000-000000000005', 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000002', 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000003', 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    ('9ef10100-0000-4000-8000-000000000001', '9ef10000-0000-4000-8000-000000000004', 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    ('9ef10200-0000-4000-8000-000000000001', '9ef10100-0000-4000-8000-000000000001', 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000055',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-055',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000056',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-056',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000057',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-057',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000082',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000055', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-55', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000083',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000056', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-56', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000084',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000057', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-57', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000085',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000057', 'refund', 100, 'NGN',
      'completed', 'paystack', '777057',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000084',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000055',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000055', 5,
      'Insufficient balance'),
    ('9ef11000-0000-4000-8000-000000000057',
      '9ef10100-0000-4000-8000-000000000001', 'refund',
      'claimed', '9ef13000-0000-4000-8000-000000000057', 1, NULL);

  -- An open outside-cancellation review blocks the manual path;
  -- its all-failed sibling exercises the failed-only escape.
  INSERT INTO public.reconciliation_review (
    issue_type, order_id, merchant_id, reason, metadata
  ) VALUES
    ('provider_refund_outside_cancellation',
      '9ef11000-0000-4000-8000-000000000055',
      '9ef10100-0000-4000-8000-000000000001',
      'audit write failed; provider refund unverified',
      '{"audit_record_failed": true}'::jsonb),
    ('provider_refund_outside_cancellation',
      '9ef11000-0000-4000-8000-000000000056',
      '9ef10100-0000-4000-8000-000000000001',
      'provider refused the outside refund',
      '{"refund_evidence": {"r1": {"provider_refund_status": "failed", "payment_transaction_id": "9ef12000-0000-4000-8000-000000000083"}}}'::jsonb);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round45_gates$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
BEGIN
  -- An open movement review vetoes the manual path exactly like
  -- pending evidence: both flags off, manual and retry refused.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000055'
  ) INTO v_result;
  IF (v_result->>'canRetry')::boolean IS DISTINCT FROM false
    OR (v_result->>'canRecordManual')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'movement review left manual path advertised, %/%',
      v_result->>'canRetry', v_result->>'canRecordManual';
  END IF;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000055', 'manual', 30,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'movement-blocked-55', NULL, true);
    RAISE EXCEPTION 'manual accepted beside open movement review';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000055', 'retry');
    RAISE EXCEPTION 'retry accepted beside open movement review';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- The failed-only escape: every nested entry refused, so no money
  -- moved and the manual records.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000056', 'manual', 30,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'failed-only-56', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 70
    OR (v_result->>'refunded')::numeric <> 30 THEN
    RAISE EXCEPTION 'failed-only escape refused, refunded % remaining %',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- Coverage that lands mid-claim keeps polling: a claimed step is
  -- still worker-owned, so full coverage reports processing until
  -- finish finalizes or fails — never refunded first.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000057'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'claimed covered order reports %, want processing',
      v_result->>'status';
  END IF;
  -- Retry gating scenarios live in order_refund_management_retry_gating.sql.
END;
$refund_round45_gates$;
ROLLBACK;
