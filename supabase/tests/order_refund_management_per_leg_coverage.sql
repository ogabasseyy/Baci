-- REGRESSION TEST: per-leg refund coverage (manager aggregate, status
-- trigger, claim gate agreement).
--
-- Covers private.capped_refund_coverage_v1: an overfunded leg caps at its
-- own amount, manual rows never cover wallet/savings legs, legs price in
-- the order currency, and internal legs require provider proof for manual
-- Paystack declarations. Split from order_refund_management.sql per the
-- 300-line boundary; fixtures use the 9ef2 namespace and roll back.
-- The finalizer internal-coverage scenario lives in
-- order_refund_finalizer_internal_coverage.sql (9ef3 namespace).
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_per_leg_coverage.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $per_leg_fixtures$
DECLARE
  v_owner_id uuid := '9ef20000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef20000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef20100-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'perleg-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'perleg-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'perleg-owner@example.test',
      'Per Leg Fixture', 'per-leg-fixture');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'perleg-manager@example.test',
      'Per Leg Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef21000-0000-4000-8000-000000000028', v_merchant_id, 'PERLEG-028',
      200, 200, 'paid', 'cancelled'),
    ('9ef21000-0000-4000-8000-000000000029', v_merchant_id, 'PERLEG-029',
      100, 100, 'paid', 'cancelled'),
    ('9ef21000-0000-4000-8000-000000000030', v_merchant_id, 'PERLEG-030',
      100, 100, 'paid', 'cancelled'),
    ('9ef21000-0000-4000-8000-000000000031', v_merchant_id, 'PERLEG-031',
      100, 100, 'paid', 'cancelled'),
    ('9ef21000-0000-4000-8000-000000000032', v_merchant_id, 'PERLEG-032',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef21000-0000-4000-8000-000000000028',
      '9ef21000-0000-4000-8000-000000000029',
      '9ef21000-0000-4000-8000-000000000030',
      '9ef21000-0000-4000-8000-000000000031',
      '9ef21000-0000-4000-8000-000000000032');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    -- An overfunded first leg: a verified 200 refund linked to one
    -- 100 leg must not cover the sibling 100 leg.
    ('9ef22000-0000-4000-8000-000000000045', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000028', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-28a', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000046', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000028', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-28b', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000047', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000028', 'refund', 200, 'NGN',
      'completed', 'paystack', 'pp-28-over',
      jsonb_build_object(
        'payment_transaction_id', '9ef22000-0000-4000-8000-000000000045',
        'provider_refund_status', 'processed')),
    -- A cash leg with a manual row declared as Paystack: a merchant
    -- claim about provider money, not internal-leg coverage without
    -- provider confirmation.
    ('9ef22000-0000-4000-8000-000000000048', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000029', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-29', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000049', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000029', 'refund', 100, 'NGN',
      'completed', 'manual', 'man-29-ps',
      jsonb_build_object(
        'payment_transaction_id', '9ef22000-0000-4000-8000-000000000048',
        'method', 'paystack')),
    -- A wallet leg with a linked manual row: wallet legs reverse
    -- through their own ledger, so the row is not refund coverage.
    ('9ef22000-0000-4000-8000-000000000050', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000030', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-30', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000051', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000030', 'refund', 100, 'NGN',
      'completed', 'manual', 'man-30',
      jsonb_build_object(
        'payment_transaction_id', '9ef22000-0000-4000-8000-000000000050',
        'method', 'bank_transfer',
        'reference', 'man-30',
        'refunded_at', '2026-09-28T12:00:00Z')),
    -- A legacy foreign-currency leg: an order-currency refund linked
    -- to it prices in different money and covers nothing.
    ('9ef22000-0000-4000-8000-000000000052', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000031', 'payment', 100, 'USD',
      'completed', 'paystack', 'fx-31', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000053', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000031', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-31-ngn',
      jsonb_build_object(
        'payment_transaction_id', '9ef22000-0000-4000-8000-000000000052',
        'provider_refund_status', 'processed')),
    -- A foreign-currency sole leg with an unattributed order-currency
    -- refund: no currency-matching leg exists to absorb it.
    ('9ef22000-0000-4000-8000-000000000054', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000032', 'payment', 100, 'USD',
      'completed', 'paystack', 'fx-32', '{}'::jsonb),
    ('9ef22000-0000-4000-8000-000000000055', v_merchant_id,
      '9ef21000-0000-4000-8000-000000000032', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-32-ngn',
      jsonb_build_object('provider_refund_status', 'processed'));

  -- Status calls read the label as the merchant manager; grants exist
  -- in-transaction and roll back with the check.
  GRANT SELECT ON public.orders TO authenticated;
END;
$per_leg_fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef20000-0000-4000-8000-000000000002',
  true
);

DO $per_leg_manager$
DECLARE
  v_result jsonb;
  v_label text;
BEGIN
  -- An overfunded leg caps at its own amount: the 200 linked to the
  -- first 100 leg counts 100, leaving the sibling leg outstanding
  -- with the label held.
  SELECT public.manage_order_refund(
    '9ef21000-0000-4000-8000-000000000028'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 100
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'overfunded leg spilled into sibling coverage, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef21000-0000-4000-8000-000000000028';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'overfunded leg flipped payment label to %', v_label;
  END IF;

  -- A manual row linked to a wallet leg is not refund coverage: the
  -- leg reverses through its own ledger, so the remainder holds and
  -- the label with it.
  SELECT public.manage_order_refund(
    '9ef21000-0000-4000-8000-000000000030'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'wallet-leg manual counted as coverage, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef21000-0000-4000-8000-000000000030';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'wallet-leg manual flipped payment label to %', v_label;
  END IF;

  -- A foreign-currency leg never absorbs order-currency refunds,
  -- linked or not: the remainder holds with the label.
  SELECT public.manage_order_refund(
    '9ef21000-0000-4000-8000-000000000031'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign leg absorbed order-currency refund, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef21000-0000-4000-8000-000000000031';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign leg flipped payment label to %', v_label;
  END IF;

  SELECT public.manage_order_refund(
    '9ef21000-0000-4000-8000-000000000032'
  ) INTO v_result;
  IF (v_result->>'refunded')::numeric <> 0
    OR (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign sole leg absorbed unattributed refund, got %/%',
      v_result->>'refunded', v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef21000-0000-4000-8000-000000000032';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign sole leg flipped payment label to %', v_label;
  END IF;
END;
$per_leg_manager$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $per_leg_claims$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- The overfunded first leg leaves its sibling uncovered: the claim
  -- stays in the worker branch instead of finalizing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef21000-0000-4000-8000-000000000028', 'refund',
    '9ef23000-0000-4000-8000-000000000028');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'overfunded leg finalized early, got %', v_status;
  END IF;
  -- A manual Paystack declaration on an internal leg is a merchant
  -- claim about provider money, not internal-leg coverage: like the
  -- external-leg gate, the claim defers without provider proof.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef21000-0000-4000-8000-000000000029', 'refund',
    '9ef23000-0000-4000-8000-000000000029');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'unverified internal paystack manual finalized, got %', v_status;
  END IF;
  -- Foreign-currency legs stay open in the claim like in the manager:
  -- the worker branch owns reconciliation, not finalization.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef21000-0000-4000-8000-000000000031', 'refund',
    '9ef23000-0000-4000-8000-000000000031');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'foreign leg finalized early, got %', v_status;
  END IF;
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef21000-0000-4000-8000-000000000032', 'refund',
    '9ef23000-0000-4000-8000-000000000032');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'foreign sole leg finalized early, got %', v_status;
  END IF;
END;
$per_leg_claims$;

ROLLBACK;
