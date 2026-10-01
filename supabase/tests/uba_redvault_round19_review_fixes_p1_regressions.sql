-- Round-19 regressions: the dedicated abandoned-draft cleanup RPC raises
-- for stale drafts whose attempt is initializing, indeterminate, or
-- initialized (all may still capture), mirroring the batch trigger.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_guest_email text := 'redvault-guest-p19@example.com';
  v_customer_guest uuid := '22222222-0000-4000-8000-0000000000e7';
  v_order_init uuid := '10000000-0000-4000-8000-0000000000e1';
  v_order_indet uuid := '10000000-0000-4000-8000-0000000000e2';
  v_order_inited uuid := '10000000-0000-4000-8000-0000000000e3';
  v_application_init uuid := 'd1000000-0000-4000-8000-0000000000e1';
  v_application_indet uuid := 'd1000000-0000-4000-8000-0000000000e2';
  v_application_inited uuid := 'd1000000-0000-4000-8000-0000000000e3';
  v_attempt_init uuid := 'd2000000-0000-4000-8000-0000000000e1';
  v_attempt_indet uuid := 'd2000000-0000-4000-8000-0000000000e2';
  v_attempt_inited uuid := 'd2000000-0000-4000-8000-0000000000e3';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000e7';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000e7';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000e7';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_policy_hash text := encode(extensions.digest(v_policy::text, 'sha256'), 'hex');
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p19@example.com', 'Redvault P19')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R19P1', 'fixed_amount', 100);
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
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P19 product', 150000, false, 'off');
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer_guest, v_merchant, NULL, v_guest_email);
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, tracking_token, total, payment_method, payment_status,
     shipping_status, created_at)
  VALUES
    (v_order_init, v_merchant, v_customer_guest, 'R19P1-INIT', 'R19P1-TOKEN-INIT', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_indet, v_merchant, v_customer_guest, 'R19P1-INDET', 'R19P1-TOKEN-INDET', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_inited, v_merchant, v_customer_guest, 'R19P1-INITED', 'R19P1-TOKEN-INITED', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_init, v_order_init, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R19P1-INIT', 'R19P1-INIT', 100, 150000, 'pending', NULL),
    (v_application_indet, v_order_indet, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R19P1-INDET', 'R19P1-INDET', 100, 150000, 'pending', NULL),
    (v_application_inited, v_order_inited, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R19P1-INITED', 'R19P1-INITED', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_init, v_application_init, v_order_init, v_merchant, 'R19P1-ATTEMPT-INIT', v_hash,
     150000, 'NGN', 'initializing', v_policy, v_policy_hash, 'ACCT_r19p1', 0, NULL, NULL),
    (v_attempt_indet, v_application_indet, v_order_indet, v_merchant, 'R19P1-ATTEMPT-INDET', v_hash,
     150000, 'NGN', 'indeterminate', v_policy, v_policy_hash, 'ACCT_r19p1', 0, NULL, NULL),
    (v_attempt_inited, v_application_inited, v_order_inited, v_merchant, 'R19P1-ATTEMPT-INITED', v_hash,
     150000, 'NGN', 'initialized', v_policy, v_policy_hash, 'ACCT_r19p1', 0, 'https://paystack.test/pay/x', NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- The dedicated RPC refuses every stale draft with funds in flight.
  BEGIN
    PERFORM public.cancel_abandoned_uba_redvault_draft(v_order_init, 72);
    RAISE EXCEPTION 'abandon cancel of initializing unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_abandoned_draft_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_abandoned_uba_redvault_draft(v_order_indet, 72);
    RAISE EXCEPTION 'abandon cancel of indeterminate unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_abandoned_draft_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_abandoned_uba_redvault_draft(v_order_inited, 72);
    RAISE EXCEPTION 'abandon cancel of initialized unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_abandoned_draft_active' THEN RAISE; END IF;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;
