-- REGRESSION TEST: the refunded-label sync trigger is idempotent.
--
-- A cancelled order's terminal refund row only flips the label once
-- the provider verdict stamp lands; proof stamps reassign the same
-- status to refire the sync (the worker's production flow). Every
-- later refire re-runs the label UPDATE, whose distinct-from guard
-- (manager RPC parity) leaves an already-refunded order unrewritten
-- so its updated_at never bumps for downstream consumers. The bare
-- unverified row must NOT flip the label on its own. Self-contained
-- fixtures use the d720 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_label_trigger_idempotent.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    'd7200000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000000',
    'authenticated', 'authenticated', 'idempotent-owner@example.test',
    'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
    '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    'd7200100-0000-4000-8000-000000000001',
    'd7200000-0000-4000-8000-000000000001',
    'idempotent-owner@example.test', 'Idempotent Fixture',
    'idempotent-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES (
    'd7201000-0000-4000-8000-000000000001',
    'd7200100-0000-4000-8000-000000000001', 'IDEM-001',
    100, 100, 'paid', 'cancelled', pg_catalog.now());

  -- Full coverage: the terminal refund row flips the label.
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('d7202000-0000-4000-8000-000000000001',
      'd7200100-0000-4000-8000-000000000001',
      'd7201000-0000-4000-8000-000000000001', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pay-idem-1', '{}'::jsonb),
    ('d7202000-0000-4000-8000-000000000002',
      'd7200100-0000-4000-8000-000000000001',
      'd7201000-0000-4000-8000-000000000001', 'refund', 100, 'NGN',
      'completed', 'paystack', 'idem-ref-1',
      pg_catalog.jsonb_build_object(
        'payment_transaction_id', 'd7202000-0000-4000-8000-000000000001'));
END;
$fixtures$;

DO $idempotent_label$
DECLARE
  v_status text;
  v_ctid_before tid;
  v_ctid_after tid;
BEGIN
  -- The bare terminal row is unverified Paystack evidence: the
  -- label gates must keep the paid label until the verdict stamp.
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'd7201000-0000-4000-8000-000000000001';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'unverified refund flipped label, got %', v_status;
  END IF;

  -- Production proof stamp: reassign the same status (refiring the
  -- sync trigger) with the provider verdict in metadata. Now the
  -- gates clear and the label flips.
  UPDATE public.transactions
     SET status = 'completed',
         metadata = metadata || pg_catalog.jsonb_build_object(
           'provider_refund_status', 'processed')
   WHERE id = 'd7202000-0000-4000-8000-000000000002';
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = 'd7201000-0000-4000-8000-000000000001';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'stamped refund did not flip label, got %', v_status;
  END IF;

  -- Tuple-version the flipped order, then refire the trigger with
  -- a same-status update: the guard must leave the row unrewritten.
  -- (updated_at cannot carry the probe inside one transaction:
  -- now() is constant there and the generic
  -- update_orders_updated_at trigger stamps it on any write; ctid
  -- changes on every real rewrite.)
  SELECT ctid INTO v_ctid_before FROM public.orders
  WHERE id = 'd7201000-0000-4000-8000-000000000001';
  UPDATE public.transactions SET status = 'completed'
  WHERE id = 'd7202000-0000-4000-8000-000000000002';

  SELECT payment_status, ctid INTO v_status, v_ctid_after
  FROM public.orders
  WHERE id = 'd7201000-0000-4000-8000-000000000001';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'refire changed the label, got %', v_status;
  END IF;
  IF v_ctid_after IS DISTINCT FROM v_ctid_before THEN
    RAISE EXCEPTION 'refire rewrote the order row';
  END IF;
END;
$idempotent_label$;

ROLLBACK;
