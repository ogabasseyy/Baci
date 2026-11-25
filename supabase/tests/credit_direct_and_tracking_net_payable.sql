-- Rollback-only SQL regression suite for ledger-aware Credit Direct token signing
-- and proof-bound guest tracking store-credit projections.
BEGIN;

SELECT pg_catalog.set_config('app.audit_actor_user_id', 'cd710000-0000-4000-8000-000000000001', true);

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('cd710000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'cd-ledger-merchant@example.test', 'test', now(), now(), now(), '{}', '{}');

INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000001', 'cd-ledger-merchant@example.test', 'Credit Direct Ledger Merchant', 'cd-ledger-merchant');

INSERT INTO public.merchant_feature_settings(merchant_id, credit_direct_enabled, credit_direct_min_amount, credit_direct_max_amount)
VALUES ('cd710000-0000-4000-8000-000000000002', true, 10000, 5000000)
ON CONFLICT (merchant_id) DO UPDATE
  SET credit_direct_enabled = true,
      credit_direct_min_amount = 10000,
      credit_direct_max_amount = 5000000;

INSERT INTO public.customers(id, merchant_id, user_id, first_name, last_name, email, phone)
VALUES ('cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000001', 'Credit', 'Guest', 'guest@example.test', '08012345678');

INSERT INTO public.products(id, merchant_id, name, price, status)
VALUES ('cd710000-0000-4000-8000-000000000004', 'cd710000-0000-4000-8000-000000000002', 'Credit Direct Phone', 50000, 'active');

INSERT INTO public.customer_wallets(id, customer_id, merchant_id, available_balance)
VALUES ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 0);

INSERT INTO public.customer_savings_goals(
  id, merchant_id, customer_id, product_id, title, target_amount, current_amount, contribution_amount,
  contribution_frequency, start_date, maturity_date, source_mode, status, completed_at,
  terms_accepted_at, non_withdrawable_accepted_at
) VALUES
  ('cd710000-0000-4000-8000-000000000006', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Partial', 5000, 5000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000007', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Full', 20000, 20000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000008', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Reversed', 15000, 15000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000009', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Partial Paid Rev', 15000, 15000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now());

-- Orders with stale amount_paid = 0 / wallet_amount_used = 0 while ledger credit exists.
INSERT INTO public.orders(id, merchant_id, customer_id, order_number, subtotal, total, currency, payment_status, payment_method, shipping_fee, discount_amount, amount_paid, wallet_amount_used, customer_email, tracking_token)
VALUES
  ('cd710000-0000-4000-8000-000000000010', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-PARTIAL', 50000, 50000, 'NGN', 'unpaid', 'credit_direct', 0, 0, 0, 0, 'guest@example.test', 'cd-track-partial'),
  ('cd710000-0000-4000-8000-000000000011', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-ZERO', 50000, 50000, 'NGN', 'pending', 'credit_direct', 0, 0, 0, 0, 'guest@example.test', 'cd-track-zero'),
  ('cd710000-0000-4000-8000-000000000012', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-REV', 50000, 50000, 'NGN', 'unpaid', 'credit_direct', 0, 0, 20000, 20000, 'guest@example.test', 'cd-track-rev'),
  ('cd710000-0000-4000-8000-000000000013', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-PARTIAL-PAID-REV', 50000, 50000, 'NGN', 'partially_paid', 'credit_direct', 0, 0, 35000, 20000, 'guest@example.test', 'cd-track-pp-rev');

INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, status, amount, balance_after, source_type, source_id)
VALUES
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 10000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000010'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 30000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000011'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 20000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000012'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'pending', 5000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000012'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'completed', 20000, 20000, 'order_reversal', 'cd710000-0000-4000-8000-000000000012'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'pending', 10000, 10000, 'order_reversal', 'cd710000-0000-4000-8000-000000000010'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 20000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000013'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'completed', 20000, 20000, 'order_reversal', 'cd710000-0000-4000-8000-000000000013');

INSERT INTO public.customer_savings_redemptions(goal_id, merchant_id, customer_id, order_id, amount, idempotency_key, metadata)
VALUES
  ('cd710000-0000-4000-8000-000000000006', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000010', 5000, 'cd-ledger-partial', '{}'::jsonb),
  ('cd710000-0000-4000-8000-000000000007', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000011', 20000, 'cd-ledger-zero', '{}'::jsonb),
  ('cd710000-0000-4000-8000-000000000008', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000012', 15000, 'cd-ledger-rev', '{"reversed_at":"2026-11-25T10:00:00Z"}'::jsonb),
  ('cd710000-0000-4000-8000-000000000009', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000013', 15000, 'cd-pp-rev', '{}'::jsonb);

SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_issued record;
  v_consumed boolean;
  v_tracking record;
BEGIN
  -- 1. Partial ledger-only order signs 35,000 (not 50,000) and consumes cleanly.
  SELECT * INTO v_issued
  FROM public.issue_credit_direct_checkout_token(
    'cd710000-0000-4000-8000-000000000010',
    'guest@example.test',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-partial',
    'cd-track-partial'
  );
  IF v_issued.signed_amount IS DISTINCT FROM 35000 THEN
    RAISE EXCEPTION 'Expected Credit Direct signed_amount 35000, got %', v_issued.signed_amount;
  END IF;
  SELECT public.set_credit_direct_session(
    v_issued.checkout_token,
    'cd710000-0000-4000-8000-000000000010',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-partial',
    35000
  ) INTO v_consumed;
  IF NOT COALESCE(v_consumed, false) THEN
    RAISE EXCEPTION 'Expected set_credit_direct_session to succeed for 35000';
  END IF;

  -- 2. 100% ledger-covered order cannot obtain a Credit Direct checkout token.
  BEGIN
    PERFORM * FROM public.issue_credit_direct_checkout_token(
      'cd710000-0000-4000-8000-000000000011',
      'guest@example.test',
      'cd710000-0000-4000-8000-000000000002',
      'cd-sess-zero',
      'cd-track-zero'
    );
    RAISE EXCEPTION '100%% ledger-covered order was allowed Credit Direct signing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_order_amount' THEN RAISE; END IF;
  END;

  -- 3. Reversed wallet/savings rows do not reduce Credit Direct signed_amount.
  SELECT * INTO v_issued
  FROM public.issue_credit_direct_checkout_token(
    'cd710000-0000-4000-8000-000000000012',
    'guest@example.test',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-rev',
    'cd-track-rev'
  );
  IF v_issued.signed_amount IS DISTINCT FROM 50000 THEN
    RAISE EXCEPTION 'Expected reversed-ledger signed_amount 50000, got %', v_issued.signed_amount;
  END IF;

  -- 4. Proof-bound guest tracking projects ledger credit while excluding reversed/pending rows.
  SELECT * INTO v_tracking
  FROM public.get_order_tracking('cd-ledger-merchant', NULL, NULL, NULL, 'cd-track-partial');
  IF v_tracking.wallet_ledger_used IS DISTINCT FROM 10000
     OR v_tracking.savings_ledger_used IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION 'Unexpected tracking ledger credit: wallet=%, savings=%',
      v_tracking.wallet_ledger_used, v_tracking.savings_ledger_used;
  END IF;

  SELECT * INTO v_tracking
  FROM public.get_order_tracking('cd-ledger-merchant', NULL, NULL, NULL, 'cd-track-rev');
  IF v_tracking.wallet_ledger_used IS DISTINCT FROM 0
     OR v_tracking.savings_ledger_used IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Reversed ledger rows leaked into tracking: wallet=%, savings=%',
      v_tracking.wallet_ledger_used, v_tracking.savings_ledger_used;
  END IF;

  -- 5. partially_paid order with stale amount_paid (wallet+savings) and completed wallet reversal
  -- keeps only active savings (15,000) and signs 35,000 (not 15,000).
  SELECT * INTO v_issued
  FROM public.issue_credit_direct_checkout_token(
    'cd710000-0000-4000-8000-000000000013',
    'guest@example.test',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-pp-rev',
    'cd-track-pp-rev'
  );
  IF v_issued.signed_amount IS DISTINCT FROM 35000 THEN
    RAISE EXCEPTION 'Expected partially_paid reversed signed_amount 35000, got %', v_issued.signed_amount;
  END IF;
END $test$;

RESET ROLE;
ROLLBACK;
