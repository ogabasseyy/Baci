-- Round-22 P1 regressions: merchandise-unit refunds distribute the line's
-- exact captured VAT across unit ordinals (floor share + remainder to the
-- first ordinals), so partial refunds are deterministic and the full line
-- sums to exactly the captured tax.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000e1';
  v_customer uuid := '22222222-0000-4000-8000-0000000000e1';
  v_order uuid := '10000000-0000-4000-8000-0000000000e1';
  v_application uuid := 'd1000000-0000-4000-8000-0000000000e1';
  v_attempt uuid := 'd2000000-0000-4000-8000-0000000000e1';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000e1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000e1';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000e1';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000e1';
  v_item uuid := '20000000-0000-4000-8000-0000000000e1';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_amount bigint;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p22@example.com', 'Redvault P22')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.merchants SET vat_registration_status = 'registered'
  WHERE id = v_merchant;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R22P1', 'fixed_amount', 100);
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
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy, vat_category_code, vat_rate)
  VALUES (v_product, v_merchant, 'Redvault P22 product', 150000, true, 'serialized_strict', 'S', 7.5);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p22@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     created_at)
  VALUES
    (v_order, v_merchant, v_customer, 'R22P1-VAT', 502.15, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes');
  -- Three N1 units at 7.5% capture 23 kobo of line VAT (8 + 8 + 7 by
  -- ordinal), which per-unit rounding would over-assign as 8 + 8 + 8.
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order, v_product, v_variant, 'Redvault P22 item', 1, 3);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application, v_order, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p22@example.com', 'R22P1-VAT', 'R22P1-VAT', 0, 300, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt, v_application, v_order, v_merchant, 'R22P1-ATTEMPT-VAT', v_hash,
     50215, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r22p1', 0, NULL,
     '{"capture_reference":"R22P1-ATTEMPT-VAT","capture_amount_kobo":"50215","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_category_code, vat_rate_bp, tax_basis)
  VALUES
    (v_application, v_item, 1, 1, 0, v_product, v_variant, 100, 'S', 750, 'exclusive'),
    (v_application, v_item, 1, 2, 0, v_product, v_variant, 100, 'S', 750, 'exclusive'),
    (v_application, v_item, 1, 3, 0, v_product, v_variant, 100, 'S', 750, 'exclusive');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- A lone middle-ordinal refund takes its deterministic share (100 + 8):
  -- the share must not depend on which subset is refunded.
  SELECT amount_kobo INTO v_amount
  FROM public.reserve_uba_redvault_refund(v_attempt, v_merchant, 'R22P1-VAT-1', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 2)));
  IF v_amount <> 108 THEN
    RAISE EXCEPTION 'partial ordinal VAT share wrong, got %', v_amount;
  END IF;
  -- The remaining ordinals complete the exact captured line VAT
  -- (108 + 107), and the sequential reservations never breach the
  -- capture guard.
  SELECT amount_kobo INTO v_amount
  FROM public.reserve_uba_redvault_refund(v_attempt, v_merchant, 'R22P1-VAT-2', 'merchandise_units',
    jsonb_build_array(
      jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 1),
      jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 3)));
  IF v_amount <> 215 THEN
    RAISE EXCEPTION 'remaining ordinals VAT wrong, got %', v_amount;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
