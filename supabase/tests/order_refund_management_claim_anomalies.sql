-- REGRESSION TEST: anomalous claim routing.
--
-- Covers cross-gateway pending, foreign-currency legs, and
-- unproven internal legs, with finalizer agreement.
-- Split from order_refund_management.sql per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_claim_anomalies.sql

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
    ('9ef11000-0000-4000-8000-000000000051',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-051',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000053',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-053',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000060',
      '9ef10100-0000-4000-8000-000000000001', 'REFUND-060',
      200, 200, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
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
    ('9ef12000-0000-4000-8000-000000000091',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000060', 'payment', 100, 'NGN',
      'completed', 'paystack', 'pp-60a', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000092',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000060', 'payment', 100, 'NGN',
      'completed', 'cash', 'cash-60b', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000093',
      '9ef10100-0000-4000-8000-000000000001',
      '9ef11000-0000-4000-8000-000000000060', 'refund', 100, 'NGN',
      'completed', 'paystack', '777060',
      jsonb_build_object(
        'payment_transaction_id', '9ef12000-0000-4000-8000-000000000091',
        'provider_refund_status', 'processed'));

  -- A foreign-currency capture that self-terminalizes is not
  -- returned money: the label must not flip on the transition.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000080';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000053';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'foreign-currency leg flipped label, got %', v_label;
  END IF;
  -- A refunded cash leg with no linked manual is not returned
  -- money either: no provider flips cash-like rows, so the label
  -- must not flip on the transition.
  UPDATE public.transactions SET status = 'refunded'
  WHERE id = '9ef12000-0000-4000-8000-000000000092';
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000060';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'refunded cash leg flipped label, got %', v_label;
  END IF;
END;
$fixtures$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef10000-0000-4000-8000-000000000002',
  true
);

DO $refund_claim_anomalies$
DECLARE
  v_won boolean;
  v_status text;
  v_label text;
  v_result jsonb;
BEGIN
  -- Anomalous terminal evidence blocks finalization like the
  -- manager's pending gate: the processed row covers the leg, but
  -- the linked Korapay row routes to the worker for quarantine
  -- instead of completing past unreconciled evidence.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000051', 'refund',
    '9ef13000-0000-4000-8000-000000000051');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'anomalous evidence finalized, got %', v_status;
  END IF;
  -- A self-terminalized foreign-currency leg is not validated
  -- money: the claim routes to the worker instead of finalizing.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000053', 'refund',
    '9ef13000-0000-4000-8000-000000000053');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'foreign-currency leg finalized, got %', v_status;
  END IF;
  -- A refunded cash leg without its linked manual blocks
  -- completion: no provider flips cash-like rows, so the status
  -- alone proves nothing and the claim routes to the worker.
  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    '9ef11000-0000-4000-8000-000000000060', 'refund',
    '9ef13000-0000-4000-8000-000000000060');
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'refunded cash leg finalized, got %', v_status;
  END IF;
  -- The finalizer agrees instead of flipping behind the manager.
  PERFORM public.finalize_refunded_cancellation_order_v1(
    '9ef11000-0000-4000-8000-000000000060',
    '9ef10100-0000-4000-8000-000000000001', NULL);
  SELECT payment_status INTO v_label FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000060';
  IF v_label <> 'paid' THEN
    RAISE EXCEPTION 'finalizer trusted refunded cash leg, got %', v_label;
  END IF;
  -- The claim pins its orders-row lock explicitly: claim-vs-manual
  -- serialization must not rest on the incidental side-effect FK.
  IF pg_get_functiondef(
    'public.claim_order_cancellation_side_effect(uuid,text,uuid)'::regprocedure
  ) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'claim lost its explicit orders lock';
  END IF;
  -- The manager re-locks the same row after authorization: without
  -- the re-lock a manual could commit between the worker's ledger
  -- read and its provider POST. Match the statement shape, not the
  -- prose comment, so deleting the lock fails even if the comment
  -- stays.
  IF pg_get_functiondef(
    'private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean,uuid)'::regprocedure
  ) NOT LIKE '%WHERE id=p_order_id FOR UPDATE;%' THEN
    RAISE EXCEPTION 'manager lost its orders re-lock';
  END IF;
END;
$refund_claim_anomalies$;
ROLLBACK;
