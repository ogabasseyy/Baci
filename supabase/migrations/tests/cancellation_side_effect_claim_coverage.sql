-- REGRESSION TEST: the cancellation refund claim auto-completes only on
-- aggregate leg coverage.
--
-- Run it after applying all migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/tests/cancellation_side_effect_claim_coverage.sql
--
-- A partial completed refund linked to a payment must NOT complete the
-- refund side effect: the claim leaves the step claimed so the executor's
-- coverage validation runs and quarantines the shortfall. Split partials
-- that sum to the leg, and legacy unlinked full refunds on sole-payment
-- orders, still auto-complete.
--
-- Everything runs in one rolled-back transaction; reruns are clean.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_merchant_id uuid := 'c0ffee00-0000-4000-8000-00000000c101';
  v_full_order uuid := 'c0ffee00-0000-4000-8000-00000000c102';
  v_partial_order uuid := 'c0ffee00-0000-4000-8000-00000000c103';
  v_split_order uuid := 'c0ffee00-0000-4000-8000-00000000c104';
  v_currency_order uuid := 'c0ffee00-0000-4000-8000-00000000c105';
  v_legacy_order uuid := 'c0ffee00-0000-4000-8000-00000000c106';
  v_unverified_order uuid := 'c0ffee00-0000-4000-8000-00000000c107';
  v_won boolean;
  v_status text;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'claim-coverage@example.com', 'Claim Coverage', 'claim-coverage');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, currency, payment_status,
    shipping_status, cancelled_at
  )
  SELECT o.id, v_merchant_id, 'ORD-CLAIM-' || o.id::text, 100, 'NGN',
    'paid', 'cancelled', now()
  FROM (VALUES (v_full_order), (v_partial_order), (v_split_order),
    (v_currency_order), (v_legacy_order), (v_unverified_order)) AS o(id);

  -- One completed 100 NGN paystack leg per order.
  INSERT INTO public.transactions (
    id, order_id, merchant_id, transaction_type, gateway,
    gateway_reference, amount, currency, status
  ) VALUES
    ('d0000000-0000-4000-8000-000000000001', v_full_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-1', 100, 'NGN',
      'completed'),
    ('d0000000-0000-4000-8000-000000000002', v_partial_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-2', 100, 'NGN',
      'completed'),
    ('d0000000-0000-4000-8000-000000000003', v_split_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-3', 100, 'NGN',
      'completed'),
    ('d0000000-0000-4000-8000-000000000004', v_currency_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-4', 100, 'NGN',
      'completed'),
    ('d0000000-0000-4000-8000-000000000005', v_legacy_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-5', 100, 'NGN',
      'completed'),
    ('d0000000-0000-4000-8000-000000000006', v_unverified_order,
      v_merchant_id, 'payment', 'paystack', 'BAC-CLAIM-6', 100, 'NGN',
      'completed');

  -- Full cover: one linked 100 refund.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_full_order, v_merchant_id, 'refund', 'paystack', '301', 100, 'NGN',
    'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000001',
      'provider_refund_status', 'processed'
    )
  );

  -- Partial: one linked 40 refund leaves 60 uncovered.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_partial_order, v_merchant_id, 'refund', 'paystack', '302', 40, 'NGN',
    'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000002',
      'provider_refund_status', 'processed'
    )
  );

  -- Split partials: linked 40 + 60 cover the leg together.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_split_order, v_merchant_id, 'refund', 'paystack', '303', 40, 'NGN',
    'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000003',
      'provider_refund_status', 'processed'
    )
  ), (
    v_split_order, v_merchant_id, 'refund', 'paystack', '304', 60, 'NGN',
    'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000003',
      'provider_refund_status', 'processed'
    )
  );

  -- Wrong currency: a linked 100 USD refund does not cover an NGN leg.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_currency_order, v_merchant_id, 'refund', 'paystack', '305', 100, 'USD',
    'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000004',
      'provider_refund_status', 'processed'
    )
  );

  -- Legacy: an unlinked full refund covers a sole-payment order.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_legacy_order, v_merchant_id, 'refund', 'paystack', '306', 100, 'NGN',
    'completed',
    jsonb_build_object('provider_refund_status', 'processed')
  );

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_full_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM false OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'full cover must auto-complete, got %/%', v_won, v_status;
  END IF;

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_partial_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM true OR v_status <> 'claimed' THEN
    RAISE EXCEPTION 'partial cover must stay claimed, got %/%', v_won, v_status;
  END IF;

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_split_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM false OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'split cover must auto-complete, got %/%', v_won, v_status;
  END IF;

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_currency_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM true OR v_status <> 'claimed' THEN
    RAISE EXCEPTION 'currency mismatch must stay claimed, got %/%', v_won, v_status;
  END IF;

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_legacy_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM false OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'legacy sole-payment cover must auto-complete, got %/%', v_won, v_status;
  END IF;

  -- Unverified: a linked full refund without provider evidence does not
  -- cover the leg; the executor must run and await verification.
  INSERT INTO public.transactions (
    order_id, merchant_id, transaction_type, gateway, gateway_reference,
    amount, currency, status, metadata
  ) VALUES (
    v_unverified_order, v_merchant_id, 'refund', 'paystack', '307', 100,
    'NGN', 'completed',
    jsonb_build_object(
      'payment_transaction_id', 'd0000000-0000-4000-8000-000000000006'
    )
  );

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_unverified_order, 'refund', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM true OR v_status <> 'claimed' THEN
    RAISE EXCEPTION 'unverified full cover must stay claimed, got %/%', v_won, v_status;
  END IF;

  SELECT we_won, current_status INTO v_won, v_status
  FROM public.claim_order_cancellation_side_effect(
    v_full_order, 'customer_email', gen_random_uuid()
  );
  IF v_won IS DISTINCT FROM true OR v_status <> 'claimed' THEN
    RAISE EXCEPTION 'email step must claim independently, got %/%', v_won, v_status;
  END IF;
END;
$$;

ROLLBACK;
