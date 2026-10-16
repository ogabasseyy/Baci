-- REGRESSION TEST: attestation and self-terminal anomalies.
--
-- Covers live-capture gaps, Paystack attestation requeue,
-- cross-gateway pending, foreign-currency legs, and
-- internal-only label persistence.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round33_anomalies.sql

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

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    ('9ef14000-0000-4000-8000-000000000001', '9ef10200-0000-4000-8000-000000000001', '9ef10100-0000-4000-8000-000000000001');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000049',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-049',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000050',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-050',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000051',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-051',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000053',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-053',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000054',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-054',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000071',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-49a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000072',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-49b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000073',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000049', 'refund', 100, 'NGN',
      'completed', 'paystack', '777049',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000071',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000074',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000050', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-50', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000075',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-51', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000076',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'refund', 100, 'NGN',
      'completed', 'paystack', '777051',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000075',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000077',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000051', 'refund', 100, 'NGN',
      'completed', 'korapay', 'kp-51',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000075')),
    ('9ef12000-0000-4000-8000-000000000080',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000053', 'payment', 100, 'USD',
      'completed', 'paystack', 'pp-53', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000081',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000054', 'payment', 100, 'NGN',
      'completed', 'wallet', 'w-54', '{}'::jsonb);

  -- Two full captures against one recorded payment: the covered
  -- capture's refund matches amount_paid, but the live capture's
  -- gap keeps the label paid — order-wide excess must not erase
  -- an identified per-leg gap.
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000049';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'live-capture gap erased by excess, got %', v_label;
  END IF;
  -- A foreign-currency capture that self-terminalizes is not
  -- returned money: the label must not flip on the transition.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000080';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000053';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign-currency leg flipped label, got %', v_label;
  END IF;
  -- The wallet-only order reverses through the internal ledger
  -- (reusing the main-block wallet and customer).
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES (
    '9ef14000-0000-4000-8000-000000000001',
    '9ef10200-0000-4000-8000-000000000001',
    '9ef10100-0000-4000-8000-000000000001', 'adjustment', 100, 180,
    'order_reversal', '9ef11000-0000-4000-8000-000000000054');
  GRANT SELECT ON public.orders TO authenticated;
  GRANT SELECT ON public.order_cancellation_side_effects TO authenticated;
  CREATE POLICY refund_suite_probe_side_effects
    ON public.order_cancellation_side_effects FOR SELECT TO authenticated
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

DO $refund_round33_anomalies$
DECLARE
  v_result jsonb;
  v_label text;
  v_attempts integer;
BEGIN
  -- Two full captures against one recorded payment: the live
  -- capture's gap keeps the full remainder recordable, and
  -- covering it finishes the order.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000049'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR NOT (v_result->>'canRecordManual')::boolean THEN
    RAISE EXCEPTION 'live-capture gap erased, remaining % recordable %',
      v_result->>'remaining', v_result->>'canRecordManual';
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000049', 'manual', 100,
    '2026-09-28T12:00:00Z', 'bank_transfer', 'live-capture-49', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 0 THEN
    RAISE EXCEPTION 'live-capture manual left remaining %',
      v_result->>'remaining';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000049';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'covered live capture did not flip label, got %',
      v_label;
  END IF;
  -- A partial Paystack attestation requeues verification even with a
  -- balance left: the claim counts as pending (blocking further
  -- records), so without a selectable side-effect row no worker
  -- would ever verify it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000050', 'manual', 30,
    '2026-09-28T12:00:00Z', 'paystack', 'verify-queue-50', NULL, true
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100
    OR (v_result->>'pending')::numeric <> 30 THEN
    RAISE EXCEPTION 'partial paystack attestation miscounted, remaining % pending %',
      v_result->>'remaining', v_result->>'pending';
  END IF;
  SELECT status, attempts INTO v_label, v_attempts
    FROM public.order_cancellation_side_effects
   WHERE order_id = '9ef11000-0000-4000-8000-000000000050'
     AND step = 'refund';
  IF NOT FOUND OR v_label <> 'failed' OR v_attempts <> 0 THEN
    RAISE EXCEPTION 'partial paystack attestation not requeued, %/%',
      v_label, v_attempts;
  END IF;
  -- Recording stays blocked until the worker verifies the claim.
  BEGIN
    PERFORM public.manage_order_refund(
      '9ef11000-0000-4000-8000-000000000050', 'manual', 30,
      '2026-09-28T12:00:00Z', 'bank_transfer', 'verify-blocked-50', NULL, true);
    RAISE EXCEPTION 'manual accepted beside unverified paystack claim';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'refund_processing_or_requires_review' THEN RAISE; END IF;
  END;
  -- A cross-gateway row beside a covered leg holds the manager
  -- pending: the claim test below asserts the aggregate gate
  -- agrees instead of finalizing past it.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000051'
  ) INTO v_result;
  IF (v_result->>'pending')::numeric <> 100 THEN
    RAISE EXCEPTION 'cross-gateway row not held pending, got %',
      v_result->>'pending';
  END IF;
  -- A self-terminalized foreign-currency leg holds the full
  -- remainder: the claim test below asserts the aggregate gate
  -- agrees instead of finalizing unvalidated money.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000053'
  ) INTO v_result;
  IF (v_result->>'remaining')::numeric <> 100 THEN
    RAISE EXCEPTION 'foreign-currency leg reduced remainder, got %',
      v_result->>'remaining';
  END IF;
  -- Internal-only reversals persist the terminal label at insert:
  -- the reversal-ledger sync flips refunded when the internal
  -- reversals cover the paid amount, so reports never see paid for
  -- an order whose money is home even when the panel never opens.
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000054';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'internal-only reversal did not flip at insert, got %',
      v_label;
  END IF;
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000054'
  ) INTO v_result;
  IF v_result->>'status' <> 'refunded' THEN
    RAISE EXCEPTION 'internal-only reversal not terminal, got %',
      v_result->>'status';
  END IF;
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000054';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'internal-only label not persisted, got %', v_label;
  END IF;
END;
$refund_round33_anomalies$;
ROLLBACK;
