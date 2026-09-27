-- Round-25 P1 regressions: guest attach requires the order's tracking
-- token as order-bound proof (a matching email alone no longer transfers
-- ownership), and held captures accept only full-capture recovery (a
-- merchandise-units refund on a held attempt would strand the remainder).
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000f5';
  v_guest_email text := 'redvault-guest-p25@example.com';
  v_customer uuid := '22222222-0000-4000-8000-0000000000f5';
  v_order_guest uuid := '10000000-0000-4000-8000-0000000000f5';
  v_order_held uuid := '10000000-0000-4000-8000-0000000000f6';
  v_application_guest uuid := 'd1000000-0000-4000-8000-0000000000f5';
  v_application_held uuid := 'd1000000-0000-4000-8000-0000000000f6';
  v_attempt_held uuid := 'd2000000-0000-4000-8000-0000000000f6';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000f5';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000f5';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000f5';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000f5';
  v_item uuid := '20000000-0000-4000-8000-0000000000f5';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_attached boolean;
  v_owner uuid;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p25@example.com', 'Redvault P25')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R25P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P25 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, v_guest_email);

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_guest, v_merchant, v_customer, 'R25P1-GUEST', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'track-r25-guest', pg_catalog.now() - interval '10 minutes'),
    (v_order_held, v_merchant, v_customer, 'R25P1-HELD', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'track-r25-held', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order_held, v_product, v_variant, 'Redvault P25 item', 150000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_guest, v_order_guest, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R25P1-GUEST', 'R25P1-GUEST', 100, 150000, 'pending', NULL),
    (v_application_held, v_order_held, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R25P1-HELD', 'R25P1-HELD', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_held, v_application_held, v_order_held, v_merchant, 'R25P1-ATTEMPT-HELD', v_hash,
     150000, 'NGN', 'captured_held', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r25p1', 0, NULL,
     '{"capture_reference":"R25P1-ATTEMPT-HELD","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_held, v_item, 1, 1, 0, v_product, v_variant, 75000, 0, 'exclusive'),
    (v_application_held, v_item, 1, 2, 0, v_product, v_variant, 75000, 0, 'exclusive');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (attach proof): a caller who knows the checkout email but not the
  -- tracking token transfers nothing, even with a matching registered
  -- email; a blank token is rejected outright.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', v_user::text, 'email', v_guest_email)::text, true);
  BEGIN
    PERFORM public.attach_redvault_guest_application_to_customer(v_order_guest, 'wrong-token');
    RAISE EXCEPTION 'attach with a wrong token unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_attach_order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.attach_redvault_guest_application_to_customer(v_order_guest, '  ');
    RAISE EXCEPTION 'attach with a blank token unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_attach_proof_required' THEN RAISE; END IF;
  END;
  SELECT public.attach_redvault_guest_application_to_customer(v_order_guest, 'track-r25-guest')
    INTO v_attached;
  IF v_attached IS NOT TRUE THEN
    RAISE EXCEPTION 'guest checkout with proof was not attached';
  END IF;
  SELECT user_id INTO v_owner FROM private.uba_redvault_applications WHERE id = v_application_guest;
  IF v_owner <> v_user THEN
    RAISE EXCEPTION 'application was not attached, got %', v_owner;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (held refunds): merchandise-units reservations against a held
  -- capture are rejected; full-capture recovery reserves normally.
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(v_attempt_held, v_merchant, 'R25P1-HELD-UNITS',
      'merchandise_units',
      jsonb_build_array(jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 1)));
    RAISE EXCEPTION 'partial refund on a held capture unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_held_full_only' THEN RAISE; END IF;
  END;
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(
    v_attempt_held, v_merchant, 'R25P1-HELD-FULL', 'full_capture');
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'full-capture recovery on a held capture did not reserve, got %', v_state;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
