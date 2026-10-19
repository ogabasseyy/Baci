-- Round-14 P1 regressions: abandoned cleanup skips live initialized
-- attempts; initialization recovery accepts the scoped customer route
-- context; the initialization claim freezes the GIGL retained-shipping
-- snapshot for the Paystack split.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-000000000091';
  v_customer uuid := '22222222-0000-4000-8000-000000000091';
  v_order_init_stale uuid := '10000000-0000-4000-8000-000000000091';
  v_order_created_stale uuid := '10000000-0000-4000-8000-000000000092';
  v_order_gigl uuid := '10000000-0000-4000-8000-000000000093';
  v_order_gigl_clamp uuid := '10000000-0000-4000-8000-000000000094';
  v_order_nongigl uuid := '10000000-0000-4000-8000-000000000095';
  v_order_rec uuid := '10000000-0000-4000-8000-000000000096';
  v_order_rec_svc uuid := '10000000-0000-4000-8000-000000000097';
  v_application_init uuid := 'd1000000-0000-4000-8000-000000000091';
  v_application_created uuid := 'd1000000-0000-4000-8000-000000000092';
  v_application_gigl uuid := 'd1000000-0000-4000-8000-000000000093';
  v_application_clamp uuid := 'd1000000-0000-4000-8000-000000000094';
  v_application_nongigl uuid := 'd1000000-0000-4000-8000-000000000095';
  v_application_rec uuid := 'd1000000-0000-4000-8000-000000000096';
  v_application_rec_svc uuid := 'd1000000-0000-4000-8000-000000000097';
  v_attempt_init uuid := 'd2000000-0000-4000-8000-000000000091';
  v_attempt_created uuid := 'd2000000-0000-4000-8000-000000000092';
  v_attempt_gigl uuid := 'd2000000-0000-4000-8000-000000000093';
  v_attempt_clamp uuid := 'd2000000-0000-4000-8000-000000000094';
  v_attempt_nongigl uuid := 'd2000000-0000-4000-8000-000000000095';
  v_attempt_rec uuid := 'd2000000-0000-4000-8000-000000000096';
  v_attempt_rec_svc uuid := 'd2000000-0000-4000-8000-000000000097';
  v_quote_gigl uuid := 'a2000000-0000-4000-8000-000000000091';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000091';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000091';
  v_product uuid := 'b0000000-0000-4000-8000-000000000091';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000091';
  v_item_init uuid := '20000000-0000-4000-8000-000000000091';
  v_unit_init uuid := 'a0000000-0000-4000-8000-000000000091';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_status text;
  v_claimed boolean;
  v_frozen bigint;
  v_url text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p14@example.com', 'Redvault P14')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R14P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P14 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p14@example.com');
  INSERT INTO public.shipping_quotes
    (id, session_id, provider, price, expires_at, merchant_id,
     provider_cost, platform_margin, pricing_version)
  VALUES (v_quote_gigl, 'R14P1-SESSION', 'GIGL', 200,
    pg_catalog.now() + interval '1 hour', v_merchant, 150, 50,
    'gigl_platform_margin_v1');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     shipping_funding_source, shipping_provider, shipping_pricing_version, shipping_platform_retained_amount,
     selected_quote_id, created_at)
  VALUES
    (v_order_init_stale, v_merchant, v_customer, 'R14P1-INIT', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '100 hours'),
    (v_order_created_stale, v_merchant, v_customer, 'R14P1-CREATED', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '100 hours'),
    (v_order_gigl, v_merchant, v_customer, 'R14P1-GIGL', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'customer_checkout', 'GIGL', 'gigl_platform_margin_v1', 200, v_quote_gigl,
     pg_catalog.now() - interval '10 minutes'),
    (v_order_gigl_clamp, v_merchant, v_customer, 'R14P1-CLAMP', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'customer_checkout', 'GIGL', 'gigl_platform_margin_v1', 200, v_quote_gigl,
     pg_catalog.now() - interval '10 minutes'),
    (v_order_nongigl, v_merchant, v_customer, 'R14P1-NONGIGL', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_rec, v_merchant, v_customer, 'R14P1-REC', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_rec_svc, v_merchant, v_customer, 'R14P1-RECSVC', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_init, v_order_init_stale, v_product, v_variant, 'Redvault P14 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES (v_unit_init, v_merchant, v_order_init_stale, v_item_init, v_variant,
    'reserved', 'serial', 'R14P1-001');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_init, v_order_init_stale, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-INIT', 'R14P1-INIT', 100, 150000, 'pending', v_user),
    (v_application_created, v_order_created_stale, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-CREATED', 'R14P1-CREATED', 100, 150000, 'pending', v_user),
    (v_application_gigl, v_order_gigl, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-GIGL', 'R14P1-GIGL', 100, 150000, 'pending', v_user),
    (v_application_clamp, v_order_gigl_clamp, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-CLAMP', 'R14P1-CLAMP', 100, 150000, 'pending', v_user),
    (v_application_nongigl, v_order_nongigl, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-NONGIGL', 'R14P1-NONGIGL', 100, 150000, 'pending', v_user),
    (v_application_rec, v_order_rec, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-REC', 'R14P1-REC', 100, 150000, 'pending', v_user),
    (v_application_rec_svc, v_order_rec_svc, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p14@example.com', 'R14P1-RECSVC', 'R14P1-RECSVC', 100, 150000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url)
  VALUES
    (v_attempt_init, v_application_init, v_order_init_stale, v_merchant, 'R14P1-ATTEMPT-INIT', v_hash,
     150000, 'NGN', 'initialized', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0,
     'https://checkout.paystack.com/r14p1-init'),
    (v_attempt_created, v_application_created, v_order_created_stale, v_merchant, 'R14P1-ATTEMPT-CREATED', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0, NULL),
    (v_attempt_gigl, v_application_gigl, v_order_gigl, v_merchant, 'R14P1-ATTEMPT-GIGL', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0, NULL),
    (v_attempt_clamp, v_application_clamp, v_order_gigl_clamp, v_merchant, 'R14P1-ATTEMPT-CLAMP', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 149950, NULL),
    (v_attempt_nongigl, v_application_nongigl, v_order_nongigl, v_merchant, 'R14P1-ATTEMPT-NONGIGL', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0, NULL),
    (v_attempt_rec, v_application_rec, v_order_rec, v_merchant, 'R14P1-ATTEMPT-REC', v_hash,
     150000, 'NGN', 'initializing', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0, NULL),
    (v_attempt_rec_svc, v_application_rec_svc, v_order_rec_svc, v_merchant, 'R14P1-ATTEMPT-RECSVC', v_hash,
     150000, 'NGN', 'initializing', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r14p1', 0, NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (abandoned cleanup): a stale draft with a live initialized attempt
  -- survives the worker batch with its fence intact; a never-initialized
  -- stale draft still cancels.
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE created_at < (pg_catalog.now() - interval '72 hours')
    AND payment_status = 'unpaid';
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_init_stale;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'initialized draft was cleaned up, got %', v_state;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory WHERE id = v_unit_init;
  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION 'initialized units were released, got %', v_status;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_created_stale;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'created stale draft was not cleaned up, got %', v_state;
  END IF;

  -- P1 (scoped recovery + split freeze): the customer route context voids
  -- its own ambiguous claim, and the claim freezes the GIGL retention.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', v_merchant::text,
    'storefront_redvault_customer_email', 'redvault-p14@example.com')::text, true);
  SELECT state, authorization_url INTO v_state, v_url
  FROM public.reconcile_storefront_redvault_payment_attempt_initialization(v_attempt_rec, 'void');
  IF v_state <> 'void' THEN
    RAISE EXCEPTION 'scoped reconcile did not void, got %', v_state;
  END IF;
  IF v_url IS NOT NULL THEN
    RAISE EXCEPTION 'voided attempt kept a URL';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
  BEGIN
    PERFORM public.reconcile_storefront_redvault_payment_attempt_initialization(v_attempt_rec_svc, 'void');
    RAISE EXCEPTION 'foreign-customer reconcile unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_context_required' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  SELECT split_retained_shipping_kobo, initialization_claimed
  INTO v_frozen, v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(v_attempt_gigl);
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'GIGL attempt was not claimable';
  END IF;
  IF v_frozen <> 20000 THEN
    RAISE EXCEPTION 'GIGL retention was not frozen, got %', v_frozen;
  END IF;
  SELECT split_retained_shipping_kobo INTO v_frozen
  FROM private.uba_redvault_payment_attempts WHERE id = v_attempt_gigl;
  IF v_frozen <> 20000 THEN
    RAISE EXCEPTION 'GIGL freeze was not persisted, got %', v_frozen;
  END IF;
  SELECT split_retained_shipping_kobo INTO v_frozen
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(v_attempt_clamp);
  IF v_frozen <> 50 THEN
    RAISE EXCEPTION 'retention clamp wrong, got %', v_frozen;
  END IF;
  SELECT split_retained_shipping_kobo INTO v_frozen
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(v_attempt_nongigl);
  IF v_frozen <> 0 THEN
    RAISE EXCEPTION 'non-GIGL freeze wrong, got %', v_frozen;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- The service_role recovery path keeps working for ops callers.
  SELECT state INTO v_state
  FROM public.reconcile_storefront_redvault_payment_attempt_initialization(v_attempt_rec_svc, 'indeterminate');
  IF v_state <> 'indeterminate' THEN
    RAISE EXCEPTION 'service reconcile did not park, got %', v_state;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
