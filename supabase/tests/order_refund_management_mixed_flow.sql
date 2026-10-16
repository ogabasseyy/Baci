-- REGRESSION TEST: mixed cash completion flow.
--
-- Covers the deferred mixed order: the merchant finishes the
-- cash balance, then the claim finalizes with confirmation.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_mixed_flow.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_manager_id uuid := '9ef10000-0000-4000-8000-000000000002';
  v_viewer_id uuid := '9ef10000-0000-4000-8000-000000000003';
  v_denied_id uuid := '9ef10000-0000-4000-8000-000000000004';
  v_m2_owner_id uuid := '9ef10000-0000-4000-8000-000000000005';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_m2_id uuid := '9ef10100-0000-4000-8000-000000000002';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
  v_product_id uuid := '9ef10300-0000-4000-8000-000000000001';
  v_goal_id uuid := '9ef10400-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_viewer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-viewer@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_denied_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-denied@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_m2_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-m2@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);


  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture'),
    (v_m2_id, v_m2_owner_id, 'refund-m2@example.test',
      'Refund Fixture Two', 'refund-fixture-two');

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_manager_id, 'refund-manager@example.test',
      'Refund Manager', 'accountant',
      '{"orders":{"refund":true}}'::jsonb, 'active'),
    (v_merchant_id, v_viewer_id, 'refund-viewer@example.test',
      'Refund Viewer', 'accountant',
      '{"orders":{"view":true}}'::jsonb, 'active'),
    (v_merchant_id, v_denied_id, 'refund-denied@example.test',
      'Refund Denied', 'accountant',
      '{"orders":{"view":false,"refund":false}}'::jsonb, 'active');


  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'REFUND-020',
      100, 100, 'paid', 'cancelled'),
    ('9ef11000-0000-4000-8000-000000000018', v_merchant_id, 'REFUND-018',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000020',
      '9ef11000-0000-4000-8000-000000000018');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000029', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000030', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'refund', 60, 'NGN',
      'completed', 'paystack', 'pp-20',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000029',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000031', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000020', 'payment', 40, 'NGN',
      'completed', 'cash', 'cash-20', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000026', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-18', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000027', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000018', 'refund', 100, 'NGN',
      'completed', 'paystack', 'legacy-18',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000026'));

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000020', v_merchant_id, 'refund',
      'failed', '9ef13000-0000-4000-8000-000000000020', 0,
      'Insufficient balance');

  -- The worker defers on the outstanding cash manual; mirror the
  -- deferral so the merchant's completion below re-arms the row.
  UPDATE public.order_cancellation_side_effects
     SET status = 'deferred', error = NULL
   WHERE order_id = '9ef11000-0000-4000-8000-000000000020'
     AND step = 'refund';
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_mixed_cash_manual$
DECLARE
  v_result jsonb;
BEGIN
  -- The merchant finishes the mixed order by recording the
  -- outstanding cash balance; the deferred row is preserved so the
  -- next drain reclaims it, and the response stays queued (not
  -- terminal refunded) until finalization runs.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000020', 'manual', 40,
    pg_catalog.now(), 'cash', 'cashrest-1',NULL,true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'mixed cash remainder did not requeue, got %',
      v_result->>'status';
  END IF;
END;
$refund_mixed_cash_manual$;


SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_mixed_cash_claim$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
BEGIN
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000020', 'refund',
    '9ef13000-0000-4000-8000-000000000021');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'mixed cash coverage did not finalize, got %', v_status;
  END IF;
  -- Provider confirmation flips an unverified row into returned
  -- money: the label follows on the status write.
  UPDATE public.transactions
     SET status = 'completed',
         metadata = metadata || '{"provider_refund_status":"processed"}'::jsonb
   WHERE id = '9ef12000-0000-4000-8000-000000000027';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000018';
  IF v_label <> 'refunded' THEN
    RAISE EXCEPTION 'verified row did not flip payment label, got %', v_label;
  END IF;
END;
$refund_mixed_cash_claim$;

ROLLBACK;
