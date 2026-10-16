-- REGRESSION TEST: round-51 review gates.
--
-- Covers the nonpositive unverified-Paystack finalization veto and
-- the mutation-only label repair (status reads never persist
-- refunds; an authorized retry does). Split per the 300-line
-- boundary; self-contained fixtures use the 9ef1 namespace and
-- roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round51_gates.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
  v_wallet_id uuid := '9ef14000-0000-4000-8000-000000000001';
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

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id);

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000091', v_merchant_id, 'REFUND-091',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000092', v_merchant_id, 'REFUND-092',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000093', v_merchant_id, 'REFUND-093',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000091', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r51-91', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000092', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000091', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-91-verified',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000091',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000093', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000091', 'refund', 0, 'NGN',
      'completed', 'paystack', 'pp-91-zero-unverified',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000091')),
    ('9ef12000-0000-4000-8000-000000000094', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000092', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r51-92', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000095', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r51-93', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000091', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000091', 0),
    ('9ef11000-0000-4000-8000-000000000092', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000092', 1),
    ('9ef11000-0000-4000-8000-000000000093', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000093', 1);

  UPDATE public.order_cancellation_side_effects SET error = 'provider down'
  WHERE order_id IN ('9ef11000-0000-4000-8000-000000000092',
    '9ef11000-0000-4000-8000-000000000093') AND step = 'refund';

  -- Stale covered label: the reversal lands with the sync trigger
  -- disabled so the status read below meets paid-while-covered.
  ALTER TABLE public.customer_wallet_transactions
    DISABLE TRIGGER sync_internal_only_refund_status_wallet;
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 100,
      'order_reversal', '9ef11000-0000-4000-8000-000000000092'),
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 200,
      'order_reversal', '9ef11000-0000-4000-8000-000000000093');
  ALTER TABLE public.customer_wallet_transactions
    ENABLE TRIGGER sync_internal_only_refund_status_wallet;

  GRANT SELECT ON public.orders TO authenticated;
  CREATE POLICY refund_suite_probe_orders_r51
    ON public.orders FOR SELECT TO authenticated
    USING (true);
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_round51_gates$
DECLARE
  v_result jsonb;
  v_label text;
BEGIN
  -- A zero-amount unverified Paystack row pins the pending gate
  -- beside full verified coverage: unconfirmed money blocks.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000091'
  ) INTO v_result;
  IF v_result->>'status' <> 'processing'
    OR (v_result->>'pending')::numeric <= 0 THEN
    RAISE EXCEPTION 'zero unverified row not pending, %/%',
      v_result->>'status', v_result->>'pending';
  END IF;
  -- A status read on a covered-but-failed order reports failed yet
  -- never persists the label: reads admit view-only callers
  -- without refund permission or CSRF protection.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000092'
  ) INTO v_result;
  IF v_result->>'status' <> 'failed' THEN
    RAISE EXCEPTION 'failed step misreported, got %',
      v_result->>'status';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000092';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'status read persisted the label, got %', v_label;
  END IF;
  -- The authorized retry mutation persists the same label the read
  -- refused to touch.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000093', 'retry'
  ) INTO v_result;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000093';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'retry left the label stale, got %', v_label;
  END IF;
END;
$refund_round51_gates$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $refund_round51_claims$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  -- The unverified-evidence veto sees nonpositive rows too: the
  -- zero-amount claim blocks finalization while the manager
  -- reports processing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000091', 'refund',
    '9ef13000-0000-4000-8000-000000000091');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'zero unverified evidence finalized, got %', v_status;
  END IF;
END;
$refund_round51_claims$;

ROLLBACK;
