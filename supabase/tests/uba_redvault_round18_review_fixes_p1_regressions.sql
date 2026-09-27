-- Round-18 regressions: abandoned cleanup reverts to a no-op for stale
-- drafts whose attempt is `initializing` or `indeterminate` (both may still
-- capture), while a stale bare draft with no live attempt still cancels.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000d7';
  v_guest_email text := 'redvault-guest-p18@example.com';
  v_customer_guest uuid := '22222222-0000-4000-8000-0000000000d7';
  v_order_init uuid := '10000000-0000-4000-8000-0000000000d1';
  v_order_indet uuid := '10000000-0000-4000-8000-0000000000d2';
  v_order_bare uuid := '10000000-0000-4000-8000-0000000000d3';
  v_application_init uuid := 'd1000000-0000-4000-8000-0000000000d1';
  v_application_indet uuid := 'd1000000-0000-4000-8000-0000000000d2';
  v_attempt_init uuid := 'd2000000-0000-4000-8000-0000000000d1';
  v_attempt_indet uuid := 'd2000000-0000-4000-8000-0000000000d2';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000d7';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000d7';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000d7';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_policy_hash text := encode(extensions.digest(v_policy::text, 'sha256'), 'hex');
  v_payment text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p18@example.com', 'Redvault P18')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R18P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P18 product', 150000, false, 'off');
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer_guest, v_merchant, NULL, v_guest_email);
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, tracking_token, total, payment_method, payment_status,
     shipping_status, created_at)
  VALUES
    (v_order_init, v_merchant, v_customer_guest, 'R18P1-INIT', 'R18P1-TOKEN-INIT', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_indet, v_merchant, v_customer_guest, 'R18P1-INDET', 'R18P1-TOKEN-INDET', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_bare, v_merchant, v_customer_guest, 'R18P1-BARE', 'R18P1-TOKEN-BARE', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_init, v_order_init, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R18P1-INIT', 'R18P1-INIT', 100, 150000, 'pending', NULL),
    (v_application_indet, v_order_indet, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R18P1-INDET', 'R18P1-INDET', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_init, v_application_init, v_order_init, v_merchant, 'R18P1-ATTEMPT-INIT', v_hash,
     150000, 'NGN', 'initializing', v_policy, v_policy_hash, 'ACCT_r18p1', 0, NULL, NULL),
    (v_attempt_indet, v_application_indet, v_order_indet, v_merchant, 'R18P1-ATTEMPT-INDET', v_hash,
     150000, 'NGN', 'indeterminate', v_policy, v_policy_hash, 'ACCT_r18p1', 0, NULL, NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- The worker batch must not abort and must leave ambiguously-initialized
  -- drafts unpaid, while the bare draft still cancels.
  PERFORM public.mark_abandoned_orders();
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_init;
  IF v_payment <> 'unpaid' THEN
    RAISE EXCEPTION 'initializing draft was cleaned up, got %', v_payment;
  END IF;
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_indet;
  IF v_payment <> 'unpaid' THEN
    RAISE EXCEPTION 'indeterminate draft was cleaned up, got %', v_payment;
  END IF;
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_bare;
  IF v_payment <> 'cancelled' THEN
    RAISE EXCEPTION 'bare draft was not cancelled, got %', v_payment;
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
