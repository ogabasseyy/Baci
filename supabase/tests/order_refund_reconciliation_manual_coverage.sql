-- REGRESSION TEST: reconciliation honors manual leg coverage.
--
-- A mixed order (manual-covered leg A, provider leg B) finishes its
-- side effect as completed; when B settles, the Paystack
-- reconciliation gate must run aggregate finalization for the whole
-- order — not strand settlement reversal, notifications, and review
-- closure because A has no same-gateway provider row.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_reconciliation_manual_coverage.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_owner_id uuid := '9ef10000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9ef10100-0000-4000-8000-000000000001';
  v_customer_id uuid := '9ef10200-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000081', v_merchant_id, 'REFUND-081',
      100, 100, 'paid', 'cancelled');

  UPDATE public.orders SET cancelled_at = pg_catalog.now()
  WHERE id = '9ef11000-0000-4000-8000-000000000081';

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000101', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'payment', 60, 'NGN',
      'completed', 'paystack', 'cap-81a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000102', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'refund', 60, 'NGN',
      'completed', 'manual', 'bank-81a#1',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000101',
        'reference', 'bank-81a', 'method', 'bank_transfer',
        'confirmed', true)),
    ('9ef12000-0000-4000-8000-000000000103', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'payment', 40, 'NGN',
      'completed', 'paystack', 'cap-81b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000104', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000081', 'refund', 40, 'NGN',
      'completed', 'paystack', '424242',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000103'));
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $reconciliation_manual_coverage$
DECLARE
  v_verdict text;
BEGIN
  -- Leg B settles at the provider: the manual-covered leg A must
  -- not block aggregate finalization.
  SELECT public.record_verified_paystack_cancellation_refund_v1(
    '9ef12000-0000-4000-8000-000000000104', 'processed', 424242, 4000, 'NGN'
  ) INTO v_verdict;
  IF v_verdict <> 'processed' THEN
    RAISE EXCEPTION 'reconciliation did not process, got %', v_verdict;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_cancellation_refund_notifications
    WHERE order_id = '9ef11000-0000-4000-8000-000000000081'
  ) THEN
    RAISE EXCEPTION 'reconciliation skipped finalization for manual-covered leg';
  END IF;
END;
$reconciliation_manual_coverage$;

RESET ROLE;

ROLLBACK;
