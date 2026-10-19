-- Round-20 P1 regressions: GIGL direct-split retention caps against gross
-- minus platform fee only (account-borne gateway fee excluded);
-- merchandise-unit refunds include exclusive-basis VAT per unit; the
-- serialized pre-submit payment check rejects refunded/missing orders.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000c1';
  v_customer uuid := '22222222-0000-4000-8000-0000000000c1';
  v_order_gigl uuid := '10000000-0000-4000-8000-0000000000c1';
  v_order_vat uuid := '10000000-0000-4000-8000-0000000000c2';
  v_order_paid uuid := '10000000-0000-4000-8000-0000000000c3';
  v_order_refunded uuid := '10000000-0000-4000-8000-0000000000c4';
  v_application_vat uuid := 'd1000000-0000-4000-8000-0000000000c1';
  v_attempt_vat uuid := 'd2000000-0000-4000-8000-0000000000c1';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000c1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000c1';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000c1';
  v_product_z uuid := 'b0000000-0000-4000-8000-0000000000c2';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000c1';
  v_item uuid := '20000000-0000-4000-8000-0000000000c1';
  v_item_z uuid := '20000000-0000-4000-8000-0000000000c2';
  v_quote_gigl uuid := 'a2000000-0000-4000-8000-0000000000c1';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_settlement uuid;
  v_net numeric;
  v_fee numeric;
  v_retained numeric;
  v_refund_amount bigint;
  v_link_net bigint;
  v_link_net_zero bigint;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p20@example.com', 'Redvault P20')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R20P1', 'fixed_amount', 100);
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
  UPDATE public.merchants SET vat_registration_status = 'registered'
  WHERE id = v_merchant;
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy, vat_category_code, vat_rate)
  VALUES (v_product, v_merchant, 'Redvault P20 product', 150000, true, 'serialized_strict', 'S', 7.5);
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy, vat_category_code, vat_rate)
  VALUES (v_product_z, v_merchant, 'Redvault P20 zero-rated', 50000, false, 'standard', 'Z', 0);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p20@example.com');

  -- The GIGL economics stamp trigger derives the retained snapshot from
  -- the selected quote price; a 1400 quote against a 1500 gross with a
  -- 100 account-borne gateway fee discriminates the cap fix (old cap
  -- 1350, fixed cap 1450).
  INSERT INTO public.shipping_quotes
    (id, session_id, provider, price, expires_at, merchant_id,
     provider_cost, platform_margin, pricing_version)
  VALUES (v_quote_gigl, 'R20P1-SESSION', 'GIGL', 1400,
    pg_catalog.now() + interval '1 hour', v_merchant, 1300, 100,
    'gigl_platform_margin_v1');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     shipping_funding_source, shipping_provider, shipping_pricing_version, shipping_platform_retained_amount,
     selected_quote_id, created_at)
  VALUES
    (v_order_gigl, v_merchant, v_customer, 'R20P1-GIGL', 1500.00, 'uba_redvault', 'paid', 'processing',
     'customer_checkout', 'GIGL', 'gigl_platform_margin_v1', 1400, v_quote_gigl,
     pg_catalog.now() - interval '10 minutes'),
    (v_order_vat, v_merchant, v_customer, 'R20P1-VAT', 2097.50, 'uba_redvault', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_paid, v_merchant, v_customer, 'R20P1-PAID', 1500.00, 'uba_redvault', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_refunded, v_merchant, v_customer, 'R20P1-REFUNDED', 1500.00, 'uba_redvault', 'refunded', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes');
  -- Line A captures VAT once per line: two N1 units at 7.5% capture 15
  -- kobo. Line B is zero-rated and captures none.
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order_vat, v_product, v_variant, 'Redvault P20 item', 1, 2);
  INSERT INTO public.order_items (id, order_id, product_id, name, price, quantity)
  VALUES (v_item_z, v_order_vat, v_product_z, 'Redvault P20 zero item', 500, 1);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_vat, v_order_vat, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p20@example.com', 'R20P1-VAT', 'R20P1-VAT', 10000, 150000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_vat, v_application_vat, v_order_vat, v_merchant, 'R20P1-ATTEMPT-VAT', v_hash,
     200000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r20p1', 0, NULL,
     '{"capture_reference":"R20P1-ATTEMPT-VAT","capture_amount_kobo":"200000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  -- Line A units share the 15 kobo captured line VAT: ordinal 1 takes 8,
  -- ordinal 2 takes 7. The zero-rated line B unit refunds net only.
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_category_code, vat_rate_bp, tax_basis)
  VALUES
    (v_application_vat, v_item, 1, 1, 0, v_product, v_variant, 100, 'S', 750, 'exclusive'),
    (v_application_vat, v_item, 1, 2, 0, v_product, v_variant, 100, 'S', 750, 'exclusive'),
    (v_application_vat, v_item_z, 2, 1, 0, v_product_z, NULL, 50000, 'Z', 0, 'exclusive');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (GIGL retention cap): the account-borne gateway fee no longer
  -- shrinks the retention bound; the full 1400 snapshot is retained.
  SELECT public.record_uba_redvault_direct_settlement_gigl_v1(v_merchant, 'order', v_order_gigl, 'paystack',
    'R20P1-GIGL-REF', 1500.00, 100, 50, 'test', '{"commerce_platform_fee":50}'::jsonb)
  INTO v_settlement;
  IF v_settlement IS NULL THEN
    RAISE EXCEPTION 'GIGL direct settlement was not recorded';
  END IF;
  SELECT net_amount, platform_fee,
    (metadata ->> 'retained_shipping_amount')::numeric
  INTO v_net, v_fee, v_retained
  FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_retained <> 1400 THEN
    RAISE EXCEPTION 'GIGL direct retention wrong, got %', v_retained;
  END IF;
  IF v_fee <> 1450 THEN
    RAISE EXCEPTION 'GIGL direct platform fee wrong, got %', v_fee;
  END IF;
  IF v_net <> 50.00 THEN
    RAISE EXCEPTION 'GIGL direct net wrong, got %', v_net;
  END IF;

  -- P1 (unit-refund VAT): line A refunds net + distributed line VAT
  -- (100 + 8 and 100 + 7) and the zero-rated line B unit refunds net
  -- only (50000).
  SELECT amount_kobo INTO v_refund_amount
  FROM public.reserve_uba_redvault_refund(v_attempt_vat, v_merchant, 'R20P1-VAT', 'merchandise_units',
    jsonb_build_array(
      jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 1),
      jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 2),
      jsonb_build_object('orderItemId', v_item_z::text, 'unitOrdinal', 1)));
  IF v_refund_amount <> 50215 THEN
    RAISE EXCEPTION 'unit refund misdistributed VAT, got %', v_refund_amount;
  END IF;
  SELECT net_amount_kobo INTO v_link_net
  FROM private.uba_redvault_refund_line_allocations
  WHERE application_id = v_application_vat AND order_item_id = v_item AND unit_ordinal = 1
    AND refund_id = (SELECT id FROM private.uba_redvault_refunds
      WHERE attempt_id = v_attempt_vat AND idempotency_key = 'R20P1-VAT');
  IF v_link_net <> 108 THEN
    RAISE EXCEPTION 'first ordinal VAT share wrong, got %', v_link_net;
  END IF;
  SELECT net_amount_kobo INTO v_link_net
  FROM private.uba_redvault_refund_line_allocations
  WHERE application_id = v_application_vat AND order_item_id = v_item AND unit_ordinal = 2
    AND refund_id = (SELECT id FROM private.uba_redvault_refunds
      WHERE attempt_id = v_attempt_vat AND idempotency_key = 'R20P1-VAT');
  IF v_link_net <> 107 THEN
    RAISE EXCEPTION 'second ordinal VAT share wrong, got %', v_link_net;
  END IF;
  SELECT net_amount_kobo INTO v_link_net_zero
  FROM private.uba_redvault_refund_line_allocations
  WHERE application_id = v_application_vat AND order_item_id = v_item_z AND unit_ordinal = 1
    AND refund_id = (SELECT id FROM private.uba_redvault_refunds
      WHERE attempt_id = v_attempt_vat AND idempotency_key = 'R20P1-VAT');
  IF v_link_net_zero <> 50000 THEN
    RAISE EXCEPTION 'zero-rated unit refund wrong, got %', v_link_net_zero;
  END IF;

  -- P1 (serialized pre-submit check): paid passes, refunded raises, and a
  -- missing order raises instead of booking blind.
  PERFORM public.assert_shippable_order_payment(v_order_paid, v_merchant);
  BEGIN
    PERFORM public.assert_shippable_order_payment(v_order_refunded, v_merchant);
    RAISE EXCEPTION 'refunded order unexpectedly passed the shipment check';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refunded_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assert_shippable_order_payment(gen_random_uuid(), v_merchant);
    RAISE EXCEPTION 'missing order unexpectedly passed the shipment check';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found_for_shipment' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
