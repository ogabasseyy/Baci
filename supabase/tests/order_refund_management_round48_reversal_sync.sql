-- REGRESSION TEST: round-48 reversal-ledger status sync.
--
-- Covers the refunded label flip from wallet/savings reversal rows
-- for internal-only cancellations that never open the refund panel,
-- plus the mixed-order negative. Split per the 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_round48_reversal_sync.sql

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
  v_product_id uuid := '9ef10300-0000-4000-8000-000000000001';
  v_goal_id uuid := '9ef10400-0000-4000-8000-000000000001';
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

  INSERT INTO public.products (id, merchant_id, name, price, status) VALUES
    (v_product_id, v_merchant_id, 'Refund Fixture Product', 100, 'active');

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id,
    'Refund Fixture Goal', 100, 10, 'weekly', '2026-01-01', '2026-12-31',
    'manual', pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id);

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000076', v_merchant_id, 'REFUND-076',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000077', v_merchant_id, 'REFUND-077',
      100, 100, 'paid', 'cancelled', pg_catalog.now()),
    ('9ef11000-0000-4000-8000-000000000078', v_merchant_id, 'REFUND-078',
      100, 100, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000091', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000076', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r48-76', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000092', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000077', 'payment', 100, 'NGN',
      'completed', 'savings', 'r48-77', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000093', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000078', 'payment', 100, 'NGN',
      'completed', 'paystack', 'r48-78', '{}'::jsonb);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 100,
      'order_reversal', '9ef11000-0000-4000-8000-000000000076'),
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 200,
      'order_reversal', '9ef11000-0000-4000-8000-000000000078');

  -- The redemption variant trigger requires the order to carry the
  -- customer and a matching order item.
  UPDATE public.orders SET customer_id = v_customer_id
  WHERE id = '9ef11000-0000-4000-8000-000000000077';

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity)
  VALUES ('9ef11000-0000-4000-8000-000000000077', v_product_id,
    'Refund Fixture Product', 100, 1);

  INSERT INTO public.customer_savings_redemptions (
    goal_id, merchant_id, customer_id, order_id, amount, idempotency_key,
    metadata
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id,
    '9ef11000-0000-4000-8000-000000000077', 100, 'refund-fixture-077',
    '{"reversed_at":"2026-10-01T00:00:00Z"}'::jsonb
  );

  INSERT INTO public.customer_savings_events (
    goal_id, merchant_id, customer_id, event_type, actor_type, actor_id,
    metadata
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id,
    'savings_order_redemption_reversed', 'merchant_staff', v_manager_id,
    jsonb_build_object(
      'amount', 100,
      'order_id', '9ef11000-0000-4000-8000-000000000077',
      'reason', 'Order cancelled')
  );
END;
$fixtures$;

-- Status reads run on the postgres role (no RLS): the trigger flips
-- synchronously on the ledger inserts above.
DO $refund_round48_status$
DECLARE
  v_status text;
BEGIN
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000076';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'wallet-only reversal left status %, want refunded',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000077';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'savings-only reversal left status %, want refunded',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000078';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'mixed-order reversal flipped status to %, want paid',
      v_status;
  END IF;
END;
$refund_round48_status$;

ROLLBACK;
