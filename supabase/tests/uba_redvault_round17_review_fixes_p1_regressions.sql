-- Round-17 regressions: customer and guest REDVAULT cancellation block while
-- a payment attempt is `initializing` (provider POST in flight) or
-- `indeterminate` (provider timeout that may hold a transaction); once
-- reconciliation moves the attempt to a terminal state, cancellation
-- succeeds again.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000c7';
  v_guest_email text := 'redvault-guest-p17@example.com';
  v_customer_guest uuid := '22222222-0000-4000-8000-0000000000c7';
  v_customer_owned uuid := '22222222-0000-4000-8000-0000000000c8';
  v_order_init_guest uuid := '10000000-0000-4000-8000-0000000000c1';
  v_order_indet_guest uuid := '10000000-0000-4000-8000-0000000000c2';
  v_order_init_cust uuid := '10000000-0000-4000-8000-0000000000c3';
  v_order_indet_cust uuid := '10000000-0000-4000-8000-0000000000c4';
  v_application_init_guest uuid := 'd1000000-0000-4000-8000-0000000000c1';
  v_application_indet_guest uuid := 'd1000000-0000-4000-8000-0000000000c2';
  v_application_init_cust uuid := 'd1000000-0000-4000-8000-0000000000c3';
  v_application_indet_cust uuid := 'd1000000-0000-4000-8000-0000000000c4';
  v_attempt_init_guest uuid := 'd2000000-0000-4000-8000-0000000000c1';
  v_attempt_indet_guest uuid := 'd2000000-0000-4000-8000-0000000000c2';
  v_attempt_init_cust uuid := 'd2000000-0000-4000-8000-0000000000c3';
  v_attempt_indet_cust uuid := 'd2000000-0000-4000-8000-0000000000c4';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000c7';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000c7';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000c7';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_policy_hash text := encode(extensions.digest(v_policy::text, 'sha256'), 'hex');
  v_payment text;
  v_cancelled boolean;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p17@example.com', 'Redvault P17')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R17P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P17 product', 150000, false, 'off');
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer_guest, v_merchant, NULL, v_guest_email),
         (v_customer_owned, v_merchant, v_user, 'redvault-owned-p17@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, tracking_token, total, payment_method, payment_status,
     shipping_status, created_at)
  VALUES
    (v_order_init_guest, v_merchant, v_customer_guest, 'R17P1-INITG', 'R17P1-TOKEN-INITG', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_indet_guest, v_merchant, v_customer_guest, 'R17P1-INDETG', 'R17P1-TOKEN-INDETG', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_init_cust, v_merchant, v_customer_owned, 'R17P1-INITC', 'R17P1-TOKEN-INITC', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_indet_cust, v_merchant, v_customer_owned, 'R17P1-INDETC', 'R17P1-TOKEN-INDETC', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_init_guest, v_order_init_guest, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R17P1-INITG', 'R17P1-INITG', 100, 150000, 'pending', NULL),
    (v_application_indet_guest, v_order_indet_guest, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R17P1-INDETG', 'R17P1-INDETG', 100, 150000, 'pending', NULL),
    (v_application_init_cust, v_order_init_cust, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-owned-p17@example.com', 'R17P1-INITC', 'R17P1-INITC', 100, 150000, 'pending', v_user),
    (v_application_indet_cust, v_order_indet_cust, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-owned-p17@example.com', 'R17P1-INDETC', 'R17P1-INDETC', 100, 150000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_init_guest, v_application_init_guest, v_order_init_guest, v_merchant, 'R17P1-ATTEMPT-INITG', v_hash,
     150000, 'NGN', 'initializing', v_policy, v_policy_hash, 'ACCT_r17p1', 0, NULL, NULL),
    (v_attempt_indet_guest, v_application_indet_guest, v_order_indet_guest, v_merchant, 'R17P1-ATTEMPT-INDETG', v_hash,
     150000, 'NGN', 'indeterminate', v_policy, v_policy_hash, 'ACCT_r17p1', 0, NULL, NULL),
    (v_attempt_init_cust, v_application_init_cust, v_order_init_cust, v_merchant, 'R17P1-ATTEMPT-INITC', v_hash,
     150000, 'NGN', 'initializing', v_policy, v_policy_hash, 'ACCT_r17p1', 0, NULL, NULL),
    (v_attempt_indet_cust, v_application_indet_cust, v_order_indet_cust, v_merchant, 'R17P1-ATTEMPT-INDETC', v_hash,
     150000, 'NGN', 'indeterminate', v_policy, v_policy_hash, 'ACCT_r17p1', 0, NULL, NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- Guest cancel blocks while the provider POST is in flight or timed out
  -- ambiguously; the inventory fence stays up until reconciliation proves
  -- the authorization cannot succeed.
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(
      v_order_init_guest, 'R17P1-TOKEN-INITG', 'changed mind');
    RAISE EXCEPTION 'guest cancel of initializing unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_guest_cancel_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(
      v_order_indet_guest, 'R17P1-TOKEN-INDETG', 'changed mind');
    RAISE EXCEPTION 'guest cancel of indeterminate unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_guest_cancel_active' THEN RAISE; END IF;
  END;

  -- The customer RPC mirrors the guest guard for owned orders.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_init_cust, 'nope');
    RAISE EXCEPTION 'customer cancel of initializing unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_indet_cust, 'nope');
    RAISE EXCEPTION 'customer cancel of indeterminate unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Resolution is not a deadlock: once reconciliation voids the ambiguous
  -- attempt, both cancel paths succeed again.
  UPDATE private.uba_redvault_payment_attempts
  SET state = 'void'
  WHERE id IN (v_attempt_indet_guest, v_attempt_indet_cust);
  SELECT public.cancel_storefront_order_as_guest(
    v_order_indet_guest, 'R17P1-TOKEN-INDETG', 'changed mind')
  INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'guest cancel after void did not cancel';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_indet_cust, 'nope')
  INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'customer cancel after void did not cancel';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_indet_cust;
  IF v_payment <> 'cancelled' THEN
    RAISE EXCEPTION 'customer cancel after void left payment %, want cancelled', v_payment;
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
