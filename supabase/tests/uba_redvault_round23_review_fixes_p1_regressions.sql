-- Round-23 P1 regressions: direct-split settlement reversals cancel the
-- settlement accounting without debiting wallet funds that were never
-- credited; wallet-backed settlements keep their exact reversal.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000f1';
  v_customer uuid := '22222222-0000-4000-8000-0000000000f1';
  v_order_full uuid := '10000000-0000-4000-8000-0000000000f1';
  v_order_full_n uuid := '10000000-0000-4000-8000-0000000000f3';
  v_order_part uuid := '10000000-0000-4000-8000-0000000000f2';
  v_application_full uuid := 'd1000000-0000-4000-8000-0000000000f1';
  v_application_full_n uuid := 'd1000000-0000-4000-8000-0000000000f3';
  v_application_part uuid := 'd1000000-0000-4000-8000-0000000000f2';
  v_attempt_full uuid := 'd2000000-0000-4000-8000-0000000000f1';
  v_attempt_full_n uuid := 'd2000000-0000-4000-8000-0000000000f3';
  v_attempt_part uuid := 'd2000000-0000-4000-8000-0000000000f2';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000f1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000f1';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_settlement uuid;
  v_available numeric;
  v_earned numeric;
  v_net numeric;
  v_status text;
  v_reversed numeric;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p23@example.com', 'Redvault P23')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id, available_balance, total_earned)
  VALUES (v_wallet, v_merchant, 10000, 10000)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R23P1', 'fixed_amount', 100);
  -- Mirror ops activation so applications pass commercial-terms validation.
  UPDATE private.uba_redvault_runtime
  SET commercial_terms_confirmed = true,
      commercial_terms = jsonb_build_object(
        'campaign_dates', jsonb_build_object(
          'starts_at', '2020-01-01T00:00:00Z', 'ends_at', '2030-01-01T00:00:00Z'),
        'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 1000),
        'caps', jsonb_build_object('discount_kobo', 1000000),
        'usage_limits', jsonb_build_object(
          'usage_limit', 1000000, 'usage_limit_per_customer', 1000000))
  WHERE partnership = 'uba_redvault';
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p23@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     created_at)
  VALUES
    (v_order_full, v_merchant, v_customer, 'R23P1-FULL', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_full_n, v_merchant, v_customer, 'R23P1-FULL-N', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_part, v_merchant, v_customer, 'R23P1-PART', 1100.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_full, v_order_full, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p23@example.com', 'R23P1-FULL', 'R23P1-FULL', 0, 150000, 'pending', v_user),
    (v_application_full_n, v_order_full_n, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p23@example.com', 'R23P1-FULL-N', 'R23P1-FULL-N', 0, 150000, 'pending', v_user),
    (v_application_part, v_order_part, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p23@example.com', 'R23P1-PART', 'R23P1-PART', 0, 110000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_full, v_application_full, v_order_full, v_merchant, 'R23P1-ATTEMPT-FULL', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r23p1', 0, NULL,
     '{"capture_reference":"R23P1-ATTEMPT-FULL","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_full_n, v_application_full_n, v_order_full_n, v_merchant, 'R23P1-ATTEMPT-FULL-N', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r23p1', 0, NULL,
     '{"capture_reference":"R23P1-ATTEMPT-FULL-N","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_part, v_application_part, v_order_part, v_merchant, 'R23P1-ATTEMPT-PART', v_hash,
     200000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r23p1', 0, NULL,
     '{"capture_reference":"R23P1-ATTEMPT-PART","capture_amount_kobo":"200000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (direct full reversal): the direct settlement cancels with no
  -- wallet movement; the wallet-backed control debits exactly.
  SELECT public.record_uba_redvault_direct_settlement(v_merchant, 'order', v_order_full, 'paystack',
    'R23P1-ATTEMPT-FULL', 1500.00, 100, 50, 'test', '{}'::jsonb)
  INTO v_settlement;
  INSERT INTO public.merchant_settlements
    (merchant_id, wallet_id, source_type, source_id, gateway, gateway_reference,
     gross_amount, gateway_fee, platform_fee, net_amount, status, metadata)
  VALUES (v_merchant, v_wallet, 'order', v_order_full_n, 'paystack',
    'R23P1-ATTEMPT-FULL-N', 1500.00, 100, 50, 200.00, 'settled', '{}'::jsonb);
  PERFORM private.reverse_uba_redvault_merchant_settlement(v_attempt_full, gen_random_uuid());
  SELECT available_balance, total_earned INTO v_available, v_earned
  FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_available <> 10000 OR v_earned <> 10000 THEN
    RAISE EXCEPTION 'direct reversal debited the wallet: % / %', v_available, v_earned;
  END IF;
  SELECT status INTO v_status FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'direct settlement was not cancelled, got %', v_status;
  END IF;
  PERFORM private.reverse_uba_redvault_merchant_settlement(v_attempt_full_n, gen_random_uuid());
  SELECT available_balance, total_earned INTO v_available, v_earned
  FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_available <> 9800 OR v_earned <> 9800 THEN
    RAISE EXCEPTION 'backed reversal wrong: % / %', v_available, v_earned;
  END IF;

  -- P1 (direct partial reversal): the settlement net and bookkeeping move
  -- while the wallet stands still.
  SELECT public.record_uba_redvault_direct_settlement(v_merchant, 'order', v_order_part, 'paystack',
    'R23P1-ATTEMPT-PART', 1100.00, 0, 100, 'test', '{}'::jsonb)
  INTO v_settlement;
  PERFORM private.reverse_uba_redvault_partial_settlement(
    v_attempt_part, gen_random_uuid(), 100000);
  SELECT available_balance, total_earned INTO v_available, v_earned
  FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_available <> 9800 OR v_earned <> 9800 THEN
    RAISE EXCEPTION 'direct partial reversal debited the wallet: % / %', v_available, v_earned;
  END IF;
  SELECT net_amount, (metadata ->> 'redvault_reversed_net_amount')::numeric
  INTO v_net, v_reversed
  FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_net <> 500.00 THEN
    RAISE EXCEPTION 'direct partial net wrong, got %', v_net;
  END IF;
  IF v_reversed <> 500.00 THEN
    RAISE EXCEPTION 'direct partial reversed bookkeeping wrong, got %', v_reversed;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
