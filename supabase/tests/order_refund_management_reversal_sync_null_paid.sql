-- REGRESSION TEST: NULL-paid internal-only reversal sync.
--
-- amount_paid is nullable since baseline. A cancelled wallet- or
-- savings-only order with a NULL total used to skip the refunded
-- label flip (NULL > 0 is unknown) even after the reversal ledger
-- covered every funded leg — and with no external gateway no side
-- effect or worker ever revisits it, so the stale paid-family
-- status stuck forever. The flip derives the paid total from
-- funded internal legs when NULL. A legacy NULL order currency
-- prices in NGN like the manager and the label trigger, so NGN
-- internal legs still count toward that derivation. Split per the
-- 300-line boundary;
-- self-contained fixtures use the 9ef1 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_management_reversal_sync_null_paid.sql

BEGIN;

-- Keep the fixture setup on the replay connection's postgres role. The
-- assertions below switch to authenticated explicitly per actor.
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
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb),
    (v_manager_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'refund-manager@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'refund-owner@example.test',
      'Refund Fixture', 'refund-fixture');

  INSERT INTO public.customers (id, merchant_id, email, full_name) VALUES
    (v_customer_id, v_merchant_id, 'refund-buyer@example.test',
      'Refund Fixture Buyer');

  INSERT INTO public.customer_wallets (id, customer_id, merchant_id) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id);

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    -- NULL total beside a fully reversed wallet leg: flips.
    ('9ef11000-0000-4000-8000-000000000090', v_merchant_id, 'REFUND-090',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- NULL total beside a partially reversed wallet leg: stays.
    ('9ef11000-0000-4000-8000-000000000091', v_merchant_id, 'REFUND-091',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- NULL total with no funded leg beside an orphan reversal: the
    -- derivation finds no evidence of what was paid and stays out.
    ('9ef11000-0000-4000-8000-000000000092', v_merchant_id, 'REFUND-092',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- NULL total whose reversal predates the trigger: the shipped
    -- backfill must admit the candidate and flip it.
    ('9ef11000-0000-4000-8000-000000000093', v_merchant_id, 'REFUND-093',
      100, NULL, 'paid', 'cancelled', pg_catalog.now()),
    -- Never-stamped zero total beside a fully reversed wallet leg:
    -- derives like NULL instead of sticking at paid.
    ('9ef11000-0000-4000-8000-000000000094', v_merchant_id, 'REFUND-094',
      100, 0, 'paid', 'cancelled', pg_catalog.now());

  -- Legacy NULL currency beside a NULL total and a fully reversed
  -- NGN wallet leg: the derivation prices the order in NGN and flips.
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, currency,
    payment_status, shipping_status, cancelled_at
  ) VALUES
    ('9ef11000-0000-4000-8000-000000000095', v_merchant_id, 'REFUND-095',
      100, NULL, NULL, 'paid', 'cancelled', pg_catalog.now());

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  ) VALUES
    ('9ef12000-0000-4000-8000-000000000090', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000090', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r50-90', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000091', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000091', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r50-91', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000093', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000093', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r50-93', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000094', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000094', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r50-94', '{}'::jsonb),
    ('9ef12000-0000-4000-8000-000000000095', v_merchant_id,
      '9ef11000-0000-4000-8000-000000000095', 'payment', 100, 'NGN',
      'completed', 'wallet', 'r50-95', '{}'::jsonb);

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 100,
      'order_reversal', '9ef11000-0000-4000-8000-000000000090'),
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 40, 140,
      'order_reversal', '9ef11000-0000-4000-8000-000000000091'),
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 240,
      'order_reversal', '9ef11000-0000-4000-8000-000000000092'),
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 340,
      'order_reversal', '9ef11000-0000-4000-8000-000000000094');

  -- Simulate a reversal that predates the migration: with the sync
  -- trigger disabled the insert leaves the label stale.
  ALTER TABLE public.customer_wallet_transactions
    DISABLE TRIGGER sync_internal_only_refund_status_wallet;
  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES (
    v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 440,
    'order_reversal', '9ef11000-0000-4000-8000-000000000093');
  ALTER TABLE public.customer_wallet_transactions
    ENABLE TRIGGER sync_internal_only_refund_status_wallet;

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id
  ) VALUES
    (v_wallet_id, v_customer_id, v_merchant_id, 'adjustment', 100, 540,
      'order_reversal', '9ef11000-0000-4000-8000-000000000095');
END;
$fixtures$;

-- Status reads run on the postgres role (no RLS): the trigger flips
-- synchronously on the ledger inserts above.
DO $refund_reversal_null_paid$
DECLARE
  v_status text;
BEGIN
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000090';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'NULL-paid full reversal left status %, want refunded',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000091';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'NULL-paid partial reversal flipped to %, want paid',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000092';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'NULL-paid legless reversal flipped to %, want paid',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000093';
  IF v_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'predated NULL-paid reversal flipped early, got %',
      v_status;
  END IF;
  PERFORM private.backfill_internal_only_refund_status();
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000093';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'backfill missed predated NULL-paid reversal, got %',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000094';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'zero-paid full reversal left status %, want refunded',
      v_status;
  END IF;
  SELECT payment_status INTO v_status FROM public.orders
  WHERE id = '9ef11000-0000-4000-8000-000000000095';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'NULL-currency full reversal left status %, want refunded',
      v_status;
  END IF;
  -- The in-function role check rejects non-service JWT roles: call
  -- as service_role (which keeps EXECUTE) with an authenticated
  -- JWT claim, isolating the body check from the ACL denial.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM private.backfill_internal_only_refund_status();
    RAISE EXCEPTION 'authenticated-JWT backfill call was allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'unauthorized' THEN RAISE; END IF;
  END;
  RESET ROLE;
END;
$refund_reversal_null_paid$;

ROLLBACK;
