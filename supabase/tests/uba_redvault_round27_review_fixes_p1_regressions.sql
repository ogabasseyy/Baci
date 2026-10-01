-- Round-27 P1 regressions: full-capture inventory review resolution
-- restocks quantity-managed stock as well as releasing serialized units.
-- Release-only reports success with zero units for manage_stock orders
-- while decremented stock stays unrestored; the resolver mirrors the
-- merchant-cancellation sequence (restock, then release).
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_customer uuid := '22222222-0000-4000-8000-0000000000b1';
  v_order uuid := '10000000-0000-4000-8000-0000000000b1';
  v_application uuid := 'd1000000-0000-4000-8000-0000000000b1';
  v_attempt uuid := 'd2000000-0000-4000-8000-0000000000b1';
  v_refund uuid := 'd3000000-0000-4000-8000-0000000000b1';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000b1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000b1';
  v_product_simple uuid := 'b0000000-0000-4000-8000-0000000000b1';
  v_product_variant uuid := 'b0000000-0000-4000-8000-0000000000b2';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000b2';
  v_item_simple uuid := '20000000-0000-4000-8000-0000000000b1';
  v_item_variant uuid := '20000000-0000-4000-8000-0000000000b2';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_receipt jsonb;
  v_stock integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p27@example.com', 'Redvault P27')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R27P1', 'fixed_amount', 100);
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
  -- Quantity-managed lines: one variant-less (product-level stock) and
  -- one variant (variant-level stock), already decremented by checkout.
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy,
    manage_stock, stock_quantity)
  VALUES
    (v_product_simple, v_merchant, 'Redvault P27 simple', 100000, false, 'simple', true, 8),
    (v_product_variant, v_merchant, 'Redvault P27 variant', 50000, true, 'simple', true, 50);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes,
    stock_quantity)
  VALUES (v_variant, v_product_variant, v_merchant, 'inherit', '{"size":"M"}'::jsonb, 4);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p27@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order, v_merchant, v_customer, 'R27P1-FULL', 1500.00, 'uba_redvault', 'refunded', 'pending',
     'track-r27-full', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES
    (v_item_simple, v_order, v_product_simple, NULL, 'Redvault P27 simple item', 100000, 2),
    (v_item_variant, v_order, v_product_variant, v_variant, 'Redvault P27 variant item', 50000, 1);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application, v_order, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p27@example.com', 'R27P1-FULL', 'R27P1-FULL', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt, v_application, v_order, v_merchant, 'R27P1-ATTEMPT-FULL', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r27p1', 0, NULL,
     '{"capture_reference":"R27P1-ATTEMPT-FULL","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES (v_refund, v_attempt, 'R27P1-FULL', 150000, 'processed', 'full_capture');
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (v_refund, v_order, 'refunded', 'review_required', 'inventory_release_requires_review', NULL);
  INSERT INTO public.reconciliation_review (issue_type, order_id, reason, metadata)
  VALUES ('serialized_inventory_confirmation_failed', v_order, 'REDVAULT refund inventory requires review',
    jsonb_build_object('refundId', v_refund, 'refundIds', jsonb_build_array(v_refund)));
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- Resolving the full-capture review restores both quantity stock
  -- levels (8 + 2, 4 + 1) alongside closing the review.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund) INTO v_receipt;
  IF (v_receipt->>'success')::boolean IS DISTINCT FROM true
    OR v_receipt->>'inventoryState' <> 'released' THEN
    RAISE EXCEPTION 'full-capture review did not resolve, got %', v_receipt;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_simple;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'product-level stock was not restocked, got %', v_stock;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant;
  IF v_stock <> 5 THEN
    RAISE EXCEPTION 'variant-level stock was not restocked, got %', v_stock;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reconciliation_review
                 WHERE order_id = v_order AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shared order review was not resolved';
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
