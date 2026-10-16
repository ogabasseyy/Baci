-- REGRESSION TEST: round-48 review gates (coverage and flags).
--
-- Covers refunded-internal retention in capped coverage, manuals off
-- in-flight external legs (manager and claim), the ordinary-Paystack
-- finalization block, cancelled_at capability gating, and the
-- per-leg failed-only movement escape. Split per the 300-line
-- boundary; self-contained fixtures use the 9ef1 namespace and
-- roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round48_gates.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated/service_role explicitly.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-4000-8000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000071', v_merchant_id, 'REFUND-071',
      200, 200, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000072', v_merchant_id, 'REFUND-072',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000073', v_merchant_id, 'REFUND-073',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000074', v_merchant_id, 'REFUND-074',
      100, 100, 'paid', 'cancelled', NULL),
    ('9ef11000-0000-4000-8000-000000000075', v_merchant_id, 'REFUND-075',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000076', v_merchant_id, 'REFUND-076',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000081', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'payment', 100, 'NGN',
      'refunded', 'cash', 'r48-71a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000082', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'payment', 100, 'NGN',
      'completed', 'cash', 'r48-71b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000083', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000071', 'refund', 100, 'NGN',
      'completed', 'manual', 'cover-71#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000081',
        'method', 'bank_transfer', 'reference', 'cover-71')),
    ('9ef12000-0000-4000-8000-000000000084', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000072', 'payment', 100, 'NGN',
      'refund_pending', 'paystack', 'r48-72', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000085', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000072', 'refund', 100, 'NGN',
      'completed', 'manual', 'cover-72#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000084',
        'method', 'bank_transfer', 'reference', 'cover-72')),
    ('9ef12000-0000-4000-8000-000000000086', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000073', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r48-73', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000087', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000073', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-73-verified',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000086',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000088', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000073', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-73-extra',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000086')),
    ('9ef12000-0000-4000-8000-000000000089', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000074', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r48-74', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000090', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000075', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r48-75', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000096', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000076', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r48-76', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000097', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000076', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-76-verified',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000096',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000098', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000076', 'refund', 0, 'USD',
      'completed', 'paystack', 'pp-76-zero-foreign',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000096',
        'provider_refund_status', 'processed'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000072', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000072', 0),
    ('9ef11000-0000-4000-8000-000000000073', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000073', 0),
    ('9ef11000-0000-4000-8000-000000000076', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000076', 0),
    ('9ef11000-0000-4000-8000-000000000074', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000074', 1);

  UPDATE public.order_cancellation_side_effects SET error = 'provider down'
  WHERE order_id = '9ef11000-0000-4000-8000-000000000074' AND step = 'refund';

  -- The only named/txn/pinned leg is failed-only: per-leg removal
  -- must escape where the old whole-review check blocked.
  INSERT INTO public.reconciliation_review (
    issue_type, txn_id, order_id, merchant_id, reason, candidates, metadata
  ) VALUES (
    'provider_refund_outside_cancellation',
    '9ef12000-0000-4000-8000-000000000090',
    '9ef11000-0000-4000-8000-000000000075', v_merchant_id,
    'provider refused the outside refund',
    '[{"payment_transaction_id": "9ef12000-0000-4000-8000-000000000090"}]'::jsonb,
    jsonb_build_object(
      'payment_transaction_id', '9ef12000-0000-4000-8000-000000000090',
      'refund_evidence', jsonb_build_object('r1', jsonb_build_object(
        'provider_refund_status', 'failed',
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000090',
        'audit_record_failed', true))));

END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round48_gates$
DECLARE
  v_result jsonb;
BEGIN
  -- A refunded internal leg keeps its linked manual coverage: the
  -- payment-side sum excludes internal gateways, so dropping the
  -- leg would report the full balance outstanding.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000071'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'refunded-cash retention lost, refunded % remaining %',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- A manual never covers an external leg whose provider refund is
  -- still in flight: counting it would double-pay on settlement.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000072'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR v_result->>'status' IS NOT DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'in-flight manual counted, %/%',
      v_result->>'status', v_result->>'remaining';
  END IF;
  -- The pending gate already pins the extra unverified provider row
  -- the claim gate now mirrors.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000073'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing'
    OR (v_result->>'pending')::numeric <= 0 THEN
    RAISE EXCEPTION 'extra paystack row not pending, %/%',
      v_result->>'status', v_result->>'pending';
  END IF;
  -- Capability flags need a real cancellation timestamp: without it
  -- retry would strand settlement and manuals need review.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000074'
  ) INTO v_result;
  IF (v_result->>'canRetry')::boolean IS DISTINCT FROM false
    OR (v_result->>'canRecordManual')::boolean IS DISTINCT FROM false
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'null cancelled_at left flags advertised, %/%/%',
      v_result->>'canRetry', v_result->>'canRecordManual',
      v_result->>'remaining';
  END IF;
  -- The failed-only escape is per leg now: the review names the leg
  -- in candidates, txn, and pin, but every entry refused, so the
  -- manual records instead of blocking on dead evidence.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000075', 'manual', 30,
    pg_catalog.now(), 'bank_transfer', 'failed-only-75', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 70
    OR (v_result->>'refunded')::numeric <> 30 THEN
    RAISE EXCEPTION 'per-leg failed-only escape refused, refunded % remaining %',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  -- A zero-amount foreign row pins the pending gate even beside full
  -- verified coverage: absence of money is not absence of evidence.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000076'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing'
    OR (v_result->>'pending')::numeric <= 0 THEN
    RAISE EXCEPTION 'zero foreign row not pending, %/%',
      v_result->>'status', v_result->>'pending';
  END IF;
END;
$refund_round48_gates$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round48_claims$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- The claim's external branch likewise refuses manuals on
  -- in-flight legs: the worker owns the order, not finalization.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000072', 'refund',
    '9ef13000-0000-4000-8000-000000000072');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'in-flight manual finalized, got %', v_status;
  END IF;
  -- An extra linked terminal Paystack row without a processed stamp
  -- blocks finalization beside full verified coverage.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000073', 'refund',
    '9ef13000-0000-4000-8000-000000000073');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'unverified extra finalized, got %', v_status;
  END IF;
  -- A zero-amount foreign row vetoes finalization like any anomaly:
  -- completing would strand the manager on processing forever.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000076', 'refund',
    '9ef13000-0000-4000-8000-000000000076');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'zero foreign anomaly finalized, got %', v_status;
  END IF;
END;
$refund_round48_claims$;

ROLLBACK;
