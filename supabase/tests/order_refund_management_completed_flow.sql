-- REGRESSION TEST: completed-row requeue flow.
--
-- Covers manual completion beside a completed row and the
-- follow-up claim with notification fan-out.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_completed_flow.sql

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
    ('9ef11000-0000-4000-8000-000000000034', v_merchant_id, 'REFUND-034',
      200, 200, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id IN (
      '9ef11000-0000-4000-8000-000000000034');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000045', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'payment', 100, 'NGN',
      'completed', 'paystack', 'cap-34', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000046', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'refund', 100, 'NGN',
      'completed', 'paystack', 'pp-34-ok',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000045',
        'provider_refund_status', 'processed')),
    ('9ef12000-0000-4000-8000-000000000047', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000034', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-34', '{}'::jsonb);

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts, error,
    completed_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000034', v_merchant_id, 'refund',
      'completed', '9ef13000-0000-4000-8000-000000000034', 1, NULL,
      '2026-09-01T00:00:00Z');

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

DO $refund_completed_row_requeue$
DECLARE
  v_result jsonb;
  v_row_status text;
BEGIN
  -- The final manual on a worker-completed row requeues it as failed
  -- so the drain reclaims it; a preserved completed status would
  -- strand settlement reversal, notifications, and review close.
  SELECT public.manage_order_refund(
    '9ef11000-0000-4000-8000-000000000034', 'manual', 100,
    pg_catalog.now(), 'cash', 'cash34-1', NULL, true
  ) INTO v_result;
  IF v_result->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'final internal manual did not requeue, got %',
      v_result->>'status';
  END IF;
  SELECT status INTO v_row_status FROM public.order_cancellation_side_effects
  WHERE order_id = '9ef11000-0000-4000-8000-000000000034'
    AND step = 'refund';
  IF v_row_status <> 'failed' THEN
    RAISE EXCEPTION 'completed row not requeued, got %', v_row_status;
  END IF;
  -- Reopening clears the old completion time: the claim stamps
  -- COALESCE(completed_at, now()), so retaining it would backdate
  -- the real finalization to before the manual was recorded.
  PERFORM 1 FROM public.order_cancellation_side_effects
  WHERE order_id = '9ef11000-0000-4000-8000-000000000034'
    AND step = 'refund' AND completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'requeued row kept its completion time';
  END IF;
END;
$refund_completed_row_requeue$;


SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_completed_row_claim$
DECLARE
  v_won boolean;
  v_status text;
BEGIN
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000034', 'refund',
    '9ef13000-0000-4000-8000-000000000036');
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'requeued mixed order did not finalize, got %', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000034') THEN
    RAISE EXCEPTION 'requeued finalization skipped notifications';
  END IF;
END;
$refund_completed_row_claim$;

ROLLBACK;
