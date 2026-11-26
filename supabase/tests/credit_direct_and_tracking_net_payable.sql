-- Rollback-only SQL regression suite for ledger-aware Credit Direct token signing
-- and proof-bound guest tracking store-credit projections.
BEGIN;

SELECT pg_catalog.set_config('app.audit_actor_user_id', 'cd710000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

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
  ('cd710000-0000-4000-8000-000000000006', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Partial', 50000, 50000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000007', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Full', 50000, 50000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000008', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Reversed', 50000, 50000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-000000000009', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Partial Paid Rev', 50000, 50000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()),
  ('cd710000-0000-4000-8000-00000000000a', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000004', 'Goal Partial Paid', 50000, 50000, 1000, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now());

-- Orders with stale amount_paid = 0 / wallet_amount_used = 0 while ledger credit exists.
INSERT INTO public.orders(id, merchant_id, customer_id, order_number, subtotal, total, currency, payment_status, payment_method, shipping_fee, discount_amount, amount_paid, wallet_amount_used, customer_email, tracking_token)
VALUES
  ('cd710000-0000-4000-8000-000000000010', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-PARTIAL', 50000, 50000, 'NGN', 'unpaid', 'credit_direct', 0, 0, 0, 0, 'guest@example.test', 'cd-track-partial'),
  ('cd710000-0000-4000-8000-000000000011', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-ZERO', 50000, 50000, 'NGN', 'pending', 'credit_direct', 0, 0, 0, 0, 'guest@example.test', 'cd-track-zero'),
  ('cd710000-0000-4000-8000-000000000012', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-LEDGER-REV', 50000, 50000, 'NGN', 'unpaid', 'credit_direct', 0, 0, 20000, 20000, 'guest@example.test', 'cd-track-rev'),
  ('cd710000-0000-4000-8000-000000000013', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-PARTIAL-PAID-REV', 50000, 50000, 'NGN', 'partially_paid', 'credit_direct', 0, 0, 35000, 20000, 'guest@example.test', 'cd-track-pp-rev'),
  ('cd710000-0000-4000-8000-000000000014', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-PARTIAL-PAID', 50000, 50000, 'NGN', 'partially_paid', 'credit_direct', 0, 0, 30000, 10000, 'guest@example.test', 'cd-track-pp'),
  ('cd710000-0000-4000-8000-000000000015', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-PARTIAL-PAID-GW-REV', 50000, 50000, 'NGN', 'partially_paid', 'credit_direct', 0, 0, 40000, 20000, 'guest@example.test', 'cd-track-pp-gw-rev'),
  ('cd710000-0000-4000-8000-000000000016', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'CD-PENDING-WALLET', 50000, 50000, 'NGN', 'unpaid', 'credit_direct', 0, 0, 0, 0, 'guest@example.test', 'cd-track-pending-wallet');

INSERT INTO public.order_items(order_id, product_id, name, price, quantity)
VALUES
  ('cd710000-0000-4000-8000-000000000010', 'cd710000-0000-4000-8000-000000000004', 'Credit Direct Phone', 50000, 1),
  ('cd710000-0000-4000-8000-000000000011', 'cd710000-0000-4000-8000-000000000004', 'Credit Direct Phone', 50000, 1),
  ('cd710000-0000-4000-8000-000000000012', 'cd710000-0000-4000-8000-000000000004', 'Credit Direct Phone', 50000, 1),
  ('cd710000-0000-4000-8000-000000000013', 'cd710000-0000-4000-8000-000000000004', 'Credit Direct Phone', 50000, 1),
  ('cd710000-0000-4000-8000-000000000014', 'cd710000-0000-4000-8000-000000000004', 'Credit Direct Phone', 50000, 1);

INSERT INTO public.customer_wallet_transactions(wallet_id, customer_id, merchant_id, type, status, amount, balance_after, source_type, source_id)
VALUES
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 10000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000010'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 30000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000011'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 20000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000012'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'pending', 5000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000016'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'completed', 20000, 20000, 'order_reversal', 'cd710000-0000-4000-8000-000000000012'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'pending', 10000, 10000, 'order_reversal', 'cd710000-0000-4000-8000-000000000010'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 20000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000013'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'completed', 20000, 20000, 'order_reversal', 'cd710000-0000-4000-8000-000000000013'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 10000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000014'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'redemption', 'completed', 20000, 0, 'order_redemption', 'cd710000-0000-4000-8000-000000000015'),
  ('cd710000-0000-4000-8000-000000000005', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000002', 'credit', 'completed', 20000, 20000, 'order_reversal', 'cd710000-0000-4000-8000-000000000015');

INSERT INTO public.customer_savings_redemptions(goal_id, merchant_id, customer_id, order_id, amount, idempotency_key, metadata)
VALUES
  ('cd710000-0000-4000-8000-000000000006', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000010', 5000, 'cd-ledger-partial', '{}'::jsonb),
  ('cd710000-0000-4000-8000-000000000007', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000011', 20000, 'cd-ledger-zero', '{}'::jsonb),
  ('cd710000-0000-4000-8000-000000000008', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000012', 15000, 'cd-ledger-rev', '{"reversed_at":"2026-11-25T10:00:00Z"}'::jsonb),
  ('cd710000-0000-4000-8000-000000000009', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000013', 15000, 'cd-pp-rev', '{}'::jsonb),
  ('cd710000-0000-4000-8000-00000000000a', 'cd710000-0000-4000-8000-000000000002', 'cd710000-0000-4000-8000-000000000003', 'cd710000-0000-4000-8000-000000000014', 5000, 'cd-pp-active', '{}'::jsonb);

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
     OR v_tracking.savings_ledger_used IS DISTINCT FROM 5000
     OR v_tracking.wallet_reversal_completed IS DISTINCT FROM FALSE
     OR v_tracking.wallet_reversed_credit IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Unexpected tracking ledger credit: wallet=%, savings=%, rev=%, rev_sum=%',
      v_tracking.wallet_ledger_used, v_tracking.savings_ledger_used, v_tracking.wallet_reversal_completed, v_tracking.wallet_reversed_credit;
  END IF;

  SELECT * INTO v_tracking
  FROM public.get_order_tracking('cd-ledger-merchant', NULL, NULL, NULL, 'cd-track-rev');
  IF v_tracking.wallet_ledger_used IS DISTINCT FROM 0
     OR v_tracking.savings_ledger_used IS DISTINCT FROM 0
     OR v_tracking.wallet_reversal_completed IS DISTINCT FROM TRUE
     OR v_tracking.wallet_reversed_credit IS DISTINCT FROM 20000 THEN
    RAISE EXCEPTION 'Reversed ledger rows leaked into tracking: wallet=%, savings=%, rev=%, rev_sum=%',
      v_tracking.wallet_ledger_used, v_tracking.savings_ledger_used, v_tracking.wallet_reversal_completed, v_tracking.wallet_reversed_credit;
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

  -- 6. partially_paid order with genuine gateway amount_paid (30,000 = 15k gateway + 10k wallet + 5k savings)
  -- subtracts amount_paid and signs 20,000 (not 35,000) in parity with shared TS computeOrderNetPayable.
  SELECT * INTO v_issued
  FROM public.issue_credit_direct_checkout_token(
    'cd710000-0000-4000-8000-000000000014',
    'guest@example.test',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-pp',
    'cd-track-pp'
  );
  IF v_issued.signed_amount IS DISTINCT FROM 20000 THEN
    RAISE EXCEPTION 'Expected partially_paid active signed_amount 20000, got %', v_issued.signed_amount;
  END IF;

  -- 6b. partially_paid order combining 20k gateway installment + 20k reversed wallet (stale amount_paid=40k)
  -- preserves the 20k gateway installment while dropping the 20k reversed wallet, signing 30,000.
  SELECT * INTO v_issued
  FROM public.issue_credit_direct_checkout_token(
    'cd710000-0000-4000-8000-000000000015',
    'guest@example.test',
    'cd710000-0000-4000-8000-000000000002',
    'cd-sess-pp-gw-rev',
    'cd-track-pp-gw-rev'
  );
  IF v_issued.signed_amount IS DISTINCT FROM 30000 THEN
    RAISE EXCEPTION 'Expected partially_paid gateway+reversed signed_amount 30000, got %', v_issued.signed_amount;
  END IF;
END $test$;

RESET ROLE;

-- 7. create_payment_transaction enforces the locked net-payable bound (35,000, not 50,000).
DO $tx_test$
DECLARE
  v_tx_id uuid;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000010',
      50000,
      'NGN',
      'klump',
      'BAC-CD-OVER-001',
      0,
      50000,
      'guest@example.test',
      'Credit Guest',
      NULL,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Pre-credit 50000 transaction was allowed on partial-credit order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_exceeds_total' THEN RAISE; END IF;
  END;

  v_tx_id := public.create_payment_transaction(
    'cd710000-0000-4000-8000-000000000002',
    'cd710000-0000-4000-8000-000000000010',
    35000,
    'NGN',
    'klump',
    'BAC-CD-NET-001',
    0,
    35000,
    'guest@example.test',
    'Credit Guest',
    NULL,
    '{}'::jsonb
  );
  IF v_tx_id IS NULL THEN
    RAISE EXCEPTION 'Expected net-payable create_payment_transaction to return transaction id';
  END IF;

  -- Idempotent retry with the same BNPL reference returns the existing transaction id.
  IF public.create_payment_transaction(
    'cd710000-0000-4000-8000-000000000002',
    'cd710000-0000-4000-8000-000000000010',
    35000,
    'NGN',
    'klump',
    'BAC-CD-NET-001',
    0,
    35000,
    'guest@example.test',
    'Credit Guest',
    NULL,
    '{}'::jsonb
  ) IS DISTINCT FROM v_tx_id THEN
    RAISE EXCEPTION 'Expected idempotent BNPL retry to return existing transaction id';
  END IF;

  -- Reject a second distinct BNPL transaction while order is bnpl_pending with a prior pending BNPL transaction.
  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000010',
      35000,
      'NGN',
      'klump',
      'BAC-CD-BNPL-DUP-001',
      0,
      35000,
      'guest@example.test',
      'Credit Guest',
      NULL,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'bnpl_pending order with active pending BNPL transaction accepted a second transaction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_invalid' THEN RAISE; END IF;
  END;

  -- Reject duplicate pending transactions on already-settled orders ('paid' and 'bnpl_approved').
  UPDATE public.orders
  SET payment_status = 'paid', amount_paid = 50000
  WHERE id = 'cd710000-0000-4000-8000-000000000010';

  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000010',
      35000,
      'NGN',
      'paystack',
      'BAC-CD-PAID-001',
      0,
      35000,
      'guest@example.test',
      'Credit Guest',
      NULL,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Settled paid order was allowed create_payment_transaction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_invalid' THEN RAISE; END IF;
  END;

  UPDATE public.orders
  SET payment_status = 'bnpl_approved', amount_paid = 50000
  WHERE id = 'cd710000-0000-4000-8000-000000000010';

  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000010',
      35000,
      'NGN',
      'klump',
      'BAC-CD-BNPL-001',
      0,
      35000,
      'guest@example.test',
      'Credit Guest',
      NULL,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Settled bnpl_approved order was allowed create_payment_transaction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_invalid' THEN RAISE; END IF;
  END;

  -- Partial wallet-funded and BNPL orders on an amendment-configured merchant must
  -- pass net-payable verification as 'untracked' instead of raising amendment_ineligible,
  -- while stale pre-credit amounts and unqualified DVA channels stay blocked.
  UPDATE public.transactions
  SET status = 'failed'
  WHERE order_id = 'cd710000-0000-4000-8000-000000000010'
    AND gateway_reference = 'BAC-CD-NET-001';

  UPDATE public.orders
  SET payment_status = 'unpaid', amount_paid = 15000, wallet_amount_used = 10000
  WHERE id = 'cd710000-0000-4000-8000-000000000010';

  INSERT INTO private.paid_order_amendment_config (merchant_id, version, enabled, paystack_integration_id)
  VALUES ('cd710000-0000-4000-8000-000000000002', 1, true, 987)
  ON CONFLICT (merchant_id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF public.claim_checkout_for_paid_order_amendment(
    'cd710000-0000-4000-8000-000000000010',
    'cd-track-partial',
    'paystack',
    'BAC-CLAIMWALLET1',
    'NGN',
    3500000
  ) IS DISTINCT FROM 'untracked' THEN
    RAISE EXCEPTION 'Partial wallet order on amendment-configured merchant was not returned as untracked';
  END IF;

  IF public.claim_checkout_for_paid_order_amendment(
    'cd710000-0000-4000-8000-000000000010',
    'cd-track-partial',
    'klump',
    'BAC-CLAIMKLUMP01',
    'NGN',
    3500000
  ) IS DISTINCT FROM 'untracked' THEN
    RAISE EXCEPTION 'Klump order with wallet credit on amendment-configured merchant was not returned as untracked';
  END IF;

  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(
      'cd710000-0000-4000-8000-000000000010',
      'cd-track-partial',
      'paystack',
      'BAC-CLAIMSTALE01',
      'NGN',
      5000000
    );
    RAISE EXCEPTION 'Stale pre-credit amount escaped claim_checkout_for_paid_order_amendment';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(
      'cd710000-0000-4000-8000-000000000010',
      'cd-track-partial',
      'paystack_dva',
      'BAC-CLAIMDVA0001',
      'NGN',
      3500000
    );
    RAISE EXCEPTION 'paystack_dva escaped amendment_ineligible on configured merchant';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;

  -- 10. Klump allows the canonical ceiling integer amount on fractional net-payable
  --     residuals while non-Klump gateways remain strictly bounded at v_net_payable.
  UPDATE public.orders
  SET total = 50000, amount_paid = 0, wallet_amount_used = 0
  WHERE id = 'cd710000-0000-4000-8000-000000000010';
  -- Order 0010 already has 5,000 in customer_savings_redemptions, so 34,999.50
  -- wallet + 5,000 savings = 39,999.50 credit, leaving 10,000.50 net payable.
  UPDATE public.customer_wallet_transactions
  SET amount = 34999.50
  WHERE source_id = 'cd710000-0000-4000-8000-000000000010'
    AND source_type = 'order_redemption';

  IF public.claim_checkout_for_paid_order_amendment(
    'cd710000-0000-4000-8000-000000000010',
    'cd-track-partial',
    'klump',
    'BAC-CLAIMKLUMP02',
    'NGN',
    1000100
  ) IS DISTINCT FROM 'untracked' THEN
    RAISE EXCEPTION 'Klump fractional ceiling minor amount was rejected by claim_checkout_for_paid_order_amendment';
  END IF;

  BEGIN
    PERFORM public.claim_checkout_for_paid_order_amendment(
      'cd710000-0000-4000-8000-000000000010',
      'cd-track-partial',
      'klump',
      'BAC-CLAIMKLUMP03',
      'NGN',
      1000050
    );
    RAISE EXCEPTION 'Non-integer Klump minor amount escaped claim_checkout_for_paid_order_amendment';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_ineligible' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_tx_id := public.create_payment_transaction(
    'cd710000-0000-4000-8000-000000000002',
    'cd710000-0000-4000-8000-000000000010',
    10001,
    'NGN',
    'klump',
    'BAC-KLUMP-CEIL-01',
    0,
    10001,
    'guest@example.test',
    'Partial Buyer'
  );
  IF v_tx_id IS NULL THEN
    RAISE EXCEPTION 'Expected canonical integer Klump create_payment_transaction to return transaction id';
  END IF;

  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000010',
      10001,
      'NGN',
      'paystack',
      'BAC-PAYSTACK-CEIL',
      0,
      10001,
      'guest@example.test',
      'Partial Buyer'
    );
    RAISE EXCEPTION 'Non-Klump gateway exceeded decimal v_net_payable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_exceeds_total' THEN RAISE; END IF;
  END;

  -- 11. create_payment_transaction preserves partially_paid status while enforcing
  --     net-payable bounds for an additional installment.
  v_tx_id := public.create_payment_transaction(
    'cd710000-0000-4000-8000-000000000002',
    'cd710000-0000-4000-8000-000000000014',
    20000,
    'NGN',
    'klump',
    'BAC-PP-KLUMP-01',
    0,
    20000,
    'guest@example.test',
    'Partial Buyer'
  );
  IF v_tx_id IS NULL THEN
    RAISE EXCEPTION 'Expected partially_paid create_payment_transaction to return transaction id';
  END IF;
  IF (
    SELECT o.payment_status
    FROM public.orders o
    WHERE o.id = 'cd710000-0000-4000-8000-000000000014'
  ) IS DISTINCT FROM 'partially_paid' THEN
    RAISE EXCEPTION 'create_payment_transaction downgraded partially_paid order status';
  END IF;

  -- Concurrent BNPL transaction on a partially_paid order with a prior pending BNPL transaction is rejected.
  BEGIN
    PERFORM public.create_payment_transaction(
      'cd710000-0000-4000-8000-000000000002',
      'cd710000-0000-4000-8000-000000000014',
      20000,
      'NGN',
      'klump',
      'BAC-PP-KLUMP-02',
      0,
      20000,
      'guest@example.test',
      'Partial Buyer'
    );
    RAISE EXCEPTION 'partially_paid order with active pending BNPL transaction accepted a second BNPL transaction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amount_invalid' THEN RAISE; END IF;
  END;

  -- 12. Mixed-case payment_status normalization matches TypeScript trim().toLowerCase().
  IF private.credit_direct_net_payable(
    'cd710000-0000-4000-8000-000000000014',
    'cd710000-0000-4000-8000-000000000002',
    50000,
    30000,
    10000,
    ' Partially_Paid '
  ) IS DISTINCT FROM 20000 THEN
    RAISE EXCEPTION 'Mixed-case Partially_Paid status diverged in credit_direct_net_payable';
  END IF;
END $tx_test$;

ROLLBACK;
