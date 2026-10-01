-- Round-31 P1/P2 regressions: refund release routing follows
-- reservation reality across policy flips; REDVAULT cancellation
-- restocks quantity lines only; inventory resolution keeps the shared
-- review open while full_capture finance is unresolved; reservation
-- still succeeds (advisory first) and rejects unknown attempts.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db76';
  v_customer uuid := '22222222-0000-4000-8000-0000000000f1';
  v_user uuid := '33333333-0000-4000-8000-0000000000f1';
  v_customer_user uuid := '22222222-0000-4000-8000-0000000000f2';
  v_order_flip uuid := '10000000-0000-4000-8000-0000000000f1';
  v_order_strict uuid := '10000000-0000-4000-8000-0000000000f2';
  v_order_qty uuid := '10000000-0000-4000-8000-0000000000f3';
  v_order_cancelc uuid := '10000000-0000-4000-8000-0000000000f4';
  v_order_cancelq uuid := '10000000-0000-4000-8000-0000000000f5';
  v_order_cancelg uuid := '10000000-0000-4000-8000-0000000000f6';
  v_order_fina uuid := '10000000-0000-4000-8000-0000000000f7';
  v_order_finb uuid := '10000000-0000-4000-8000-0000000000f8';
  v_order_finc uuid := '10000000-0000-4000-8000-0000000000f9';
  v_order_rsv uuid := '10000000-0000-4000-8000-0000000000fa';
  v_application_flip uuid := 'd1000000-0000-4000-8000-0000000000f1';
  v_application_strict uuid := 'd1000000-0000-4000-8000-0000000000f2';
  v_application_qty uuid := 'd1000000-0000-4000-8000-0000000000f3';
  v_application_fina uuid := 'd1000000-0000-4000-8000-0000000000f4';
  v_application_finb uuid := 'd1000000-0000-4000-8000-0000000000f5';
  v_application_finc uuid := 'd1000000-0000-4000-8000-0000000000f6';
  v_application_rsv uuid := 'd1000000-0000-4000-8000-0000000000f7';
  v_attempt_flip uuid := 'd2000000-0000-4000-8000-0000000000f1';
  v_attempt_strict uuid := 'd2000000-0000-4000-8000-0000000000f2';
  v_attempt_qty uuid := 'd2000000-0000-4000-8000-0000000000f3';
  v_attempt_fina uuid := 'd2000000-0000-4000-8000-0000000000f4';
  v_attempt_finb uuid := 'd2000000-0000-4000-8000-0000000000f5';
  v_attempt_finc uuid := 'd2000000-0000-4000-8000-0000000000f6';
  v_attempt_rsv uuid := 'd2000000-0000-4000-8000-0000000000f7';
  v_refund_flip uuid := 'd3000000-0000-4000-8000-0000000000f1';
  v_refund_strict uuid := 'd3000000-0000-4000-8000-0000000000f2';
  v_refund_qty uuid := 'd3000000-0000-4000-8000-0000000000f3';
  v_refund_fina uuid := 'd3000000-0000-4000-8000-0000000000f4';
  v_refund_finb uuid := 'd3000000-0000-4000-8000-0000000000f5';
  v_refund_finfull uuid := 'd3000000-0000-4000-8000-0000000000f6';
  v_refund_finpart uuid := 'd3000000-0000-4000-8000-0000000000f7';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000f1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000f1';
  v_product_flip uuid := 'b0000000-0000-4000-8000-0000000000f1';
  v_product_strict uuid := 'b0000000-0000-4000-8000-0000000000f2';
  v_product_qty uuid := 'b0000000-0000-4000-8000-0000000000f3';
  v_product_cancelc uuid := 'b0000000-0000-4000-8000-0000000000f4';
  v_product_cancelq uuid := 'b0000000-0000-4000-8000-0000000000f5';
  v_product_cancelg uuid := 'b0000000-0000-4000-8000-0000000000f6';
  v_product_fina uuid := 'b0000000-0000-4000-8000-0000000000f7';
  v_product_finb uuid := 'b0000000-0000-4000-8000-0000000000f8';
  v_product_finc uuid := 'b0000000-0000-4000-8000-0000000000f9';
  v_product_rsv uuid := 'b0000000-0000-4000-8000-0000000000fa';
  v_variant_flip uuid := 'c0000000-0000-4000-8000-0000000000f1';
  v_variant_strict uuid := 'c0000000-0000-4000-8000-0000000000f2';
  v_variant_cancelc uuid := 'c0000000-0000-4000-8000-0000000000f4';
  v_variant_cancelg uuid := 'c0000000-0000-4000-8000-0000000000f6';
  v_item_flip uuid := '20000000-0000-4000-8000-0000000000f1';
  v_item_strict uuid := '20000000-0000-4000-8000-0000000000f2';
  v_item_qty uuid := '20000000-0000-4000-8000-0000000000f3';
  v_item_cancelc uuid := '20000000-0000-4000-8000-0000000000f4';
  v_item_cancelq uuid := '20000000-0000-4000-8000-0000000000f5';
  v_item_cancelg uuid := '20000000-0000-4000-8000-0000000000f6';
  v_item_fina uuid := '20000000-0000-4000-8000-0000000000f7';
  v_item_finb uuid := '20000000-0000-4000-8000-0000000000f8';
  v_item_finc uuid := '20000000-0000-4000-8000-0000000000f9';
  v_item_rsv uuid := '20000000-0000-4000-8000-0000000000fa';
  v_unit_flip1 uuid := '40000000-0000-4000-8000-0000000000f1';
  v_unit_flip2 uuid := '40000000-0000-4000-8000-0000000000f2';
  v_unit_strict1 uuid := '40000000-0000-4000-8000-0000000000f3';
  v_unit_strict2 uuid := '40000000-0000-4000-8000-0000000000f4';
  v_unit_cancelc1 uuid := '40000000-0000-4000-8000-0000000000f5';
  v_unit_cancelc2 uuid := '40000000-0000-4000-8000-0000000000f6';
  v_unit_cancelg1 uuid := '40000000-0000-4000-8000-0000000000f7';
  v_unit_cancelg2 uuid := '40000000-0000-4000-8000-0000000000f8';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_stock integer;
  v_qty integer;
  v_locks_before integer;
  v_locks_after integer;
  v_receipt jsonb;
  v_ok boolean;
  v_resolved timestamptz;
  v_reason text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p31@example.com', 'Redvault P31')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R31P1', 'fixed_amount', 100);
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
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy,
    manage_stock, stock_quantity)
  VALUES
    (v_product_flip, v_merchant, 'Redvault P31 flip', 75000, true, 'serialized_strict', true, 10),
    (v_product_strict, v_merchant, 'Redvault P31 strict', 75000, true, 'serialized_strict', true, 10),
    (v_product_qty, v_merchant, 'Redvault P31 qty', 75000, false, 'simple', true, 10),
    (v_product_cancelc, v_merchant, 'Redvault P31 cancelc', 75000, true, 'serialized_strict', true, 10),
    (v_product_cancelq, v_merchant, 'Redvault P31 cancelq', 75000, false, 'simple', true, 10),
    (v_product_cancelg, v_merchant, 'Redvault P31 cancelg', 75000, true, 'serialized_strict', true, 10),
    (v_product_fina, v_merchant, 'Redvault P31 fina', 75000, false, 'simple', true, 10),
    (v_product_finb, v_merchant, 'Redvault P31 finb', 75000, false, 'simple', true, 10),
    (v_product_finc, v_merchant, 'Redvault P31 finc', 75000, false, 'simple', true, 10),
    (v_product_rsv, v_merchant, 'Redvault P31 rsv', 75000, false, 'simple', true, 10);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes,
    stock_quantity)
  VALUES
    (v_variant_flip, v_product_flip, v_merchant, 'inherit', '{"color":"red"}'::jsonb, 10),
    (v_variant_strict, v_product_strict, v_merchant, 'inherit', '{"color":"red"}'::jsonb, 10),
    (v_variant_cancelc, v_product_cancelc, v_merchant, 'inherit', '{"color":"red"}'::jsonb, 10),
    (v_variant_cancelg, v_product_cancelg, v_merchant, 'inherit', '{"color":"red"}'::jsonb, 10);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES
    (v_customer, v_merchant, NULL, 'redvault-p31@example.com'),
    (v_customer_user, v_merchant, v_user, 'redvault-owner-p31@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, customer_email, order_number, total, currency, payment_method,
     payment_status, shipping_status, tracking_token, created_at)
  VALUES
    (v_order_flip, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-FLIP',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-flip',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_strict, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-STRICT',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-strict',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_qty, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-QTY',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-qty',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cancelc, v_merchant, v_customer_user, 'redvault-owner-p31@example.com', 'R31P1-CANCELC',
     1500.00, 'NGN', 'uba_redvault', 'unpaid', 'pending', 'track-r31-cancelc',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cancelq, v_merchant, v_customer_user, 'redvault-owner-p31@example.com', 'R31P1-CANCELQ',
     1500.00, 'NGN', 'uba_redvault', 'unpaid', 'pending', 'track-r31-cancelq',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cancelg, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-CANCELG',
     1500.00, 'NGN', 'uba_redvault', 'unpaid', 'pending', 'track-r31-cancelg',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_fina, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-FINA',
     750.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-fina',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_finb, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-FINB',
     750.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-finb',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_finc, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-FINC',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-finc',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_rsv, v_merchant, v_customer, 'redvault-p31@example.com', 'R31P1-RSV',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r31-rsv',
     pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES
    (v_item_flip, v_order_flip, v_product_flip, v_variant_flip, 'Redvault P31 flip item', 75000, 2),
    (v_item_strict, v_order_strict, v_product_strict, v_variant_strict, 'Redvault P31 strict item', 75000, 2),
    (v_item_qty, v_order_qty, v_product_qty, NULL, 'Redvault P31 qty item', 75000, 2),
    (v_item_cancelc, v_order_cancelc, v_product_cancelc, v_variant_cancelc, 'Redvault P31 cancelc item', 75000, 2),
    (v_item_cancelq, v_order_cancelq, v_product_cancelq, NULL, 'Redvault P31 cancelq item', 75000, 2),
    (v_item_cancelg, v_order_cancelg, v_product_cancelg, v_variant_cancelg, 'Redvault P31 cancelg item', 75000, 2),
    (v_item_fina, v_order_fina, v_product_fina, NULL, 'Redvault P31 fina item', 75000, 1),
    (v_item_finb, v_order_finb, v_product_finb, NULL, 'Redvault P31 finb item', 75000, 1),
    (v_item_finc, v_order_finc, v_product_finc, NULL, 'Redvault P31 finc item', 75000, 2),
    (v_item_rsv, v_order_rsv, v_product_rsv, NULL, 'Redvault P31 rsv item', 75000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_flip, v_order_flip, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-FLIP', 'R31P1-FLIP', 100, 150000, 'pending', NULL),
    (v_application_strict, v_order_strict, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-STRICT', 'R31P1-STRICT', 100, 150000, 'pending', NULL),
    (v_application_qty, v_order_qty, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-QTY', 'R31P1-QTY', 100, 150000, 'pending', NULL),
    (v_application_fina, v_order_fina, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-FINA', 'R31P1-FINA', 100, 75000, 'pending', NULL),
    (v_application_finb, v_order_finb, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-FINB', 'R31P1-FINB', 100, 75000, 'pending', NULL),
    (v_application_finc, v_order_finc, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-FINC', 'R31P1-FINC', 100, 150000, 'pending', NULL),
    (v_application_rsv, v_order_rsv, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p31@example.com', 'R31P1-RSV', 'R31P1-RSV', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_flip, v_application_flip, v_order_flip, v_merchant, 'R31P1-ATTEMPT-FLIP', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-FLIP","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_strict, v_application_strict, v_order_strict, v_merchant, 'R31P1-ATTEMPT-STRICT', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-STRICT","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_qty, v_application_qty, v_order_qty, v_merchant, 'R31P1-ATTEMPT-QTY', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-QTY","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_fina, v_application_fina, v_order_fina, v_merchant, 'R31P1-ATTEMPT-FINA', v_hash,
     75000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-FINA","capture_amount_kobo":"75000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_finb, v_application_finb, v_order_finb, v_merchant, 'R31P1-ATTEMPT-FINB', v_hash,
     75000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-FINB","capture_amount_kobo":"75000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_finc, v_application_finc, v_order_finc, v_merchant, 'R31P1-ATTEMPT-FINC', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-FINC","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_rsv, v_application_rsv, v_order_rsv, v_merchant, 'R31P1-ATTEMPT-RSV', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r31p1', 0, NULL,
     '{"capture_reference":"R31P1-ATTEMPT-RSV","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_flip, v_item_flip, 1, 1, 0, v_product_flip, v_variant_flip, 75000, 0, 'exclusive'),
    (v_application_flip, v_item_flip, 1, 2, 0, v_product_flip, v_variant_flip, 75000, 0, 'exclusive'),
    (v_application_strict, v_item_strict, 1, 1, 0, v_product_strict, v_variant_strict, 75000, 0, 'exclusive'),
    (v_application_strict, v_item_strict, 1, 2, 0, v_product_strict, v_variant_strict, 75000, 0, 'exclusive'),
    (v_application_qty, v_item_qty, 1, 1, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_qty, v_item_qty, 1, 2, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_finc, v_item_finc, 1, 1, 0, v_product_finc, NULL, 75000, 0, 'exclusive'),
    (v_application_finc, v_item_finc, 1, 2, 0, v_product_finc, NULL, 75000, 0, 'exclusive'),
    (v_application_rsv, v_item_rsv, 1, 1, 0, v_product_rsv, NULL, 75000, 0, 'exclusive'),
    (v_application_rsv, v_item_rsv, 1, 2, 0, v_product_rsv, NULL, 75000, 0, 'exclusive');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES
    (v_refund_flip, v_attempt_flip, 'R31P1-FLIP', 75000, 'processed', 'merchandise_units'),
    (v_refund_strict, v_attempt_strict, 'R31P1-STRICT', 75000, 'processed', 'merchandise_units'),
    (v_refund_qty, v_attempt_qty, 'R31P1-QTY', 75000, 'processed', 'merchandise_units'),
    (v_refund_fina, v_attempt_fina, 'R31P1-FINA', 75000, 'processed', 'full_capture'),
    (v_refund_finb, v_attempt_finb, 'R31P1-FINB', 75000, 'processed', 'full_capture'),
    (v_refund_finfull, v_attempt_finc, 'R31P1-FINFULL', 75000, 'processed', 'full_capture'),
    (v_refund_finpart, v_attempt_finc, 'R31P1-FINPART', 75000, 'processed', 'merchandise_units');
  INSERT INTO private.uba_redvault_refund_line_allocations
    (refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
  VALUES
    (v_refund_flip, v_application_flip, v_item_flip, 1, 75000),
    (v_refund_strict, v_application_strict, v_item_strict, 1, 75000),
    (v_refund_qty, v_application_qty, v_item_qty, 1, 75000),
    (v_refund_finpart, v_application_finc, v_item_finc, 1, 75000);
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES
    (v_refund_flip, v_order_flip, 'review_required', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_strict, v_order_strict, 'review_required', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_qty, v_order_qty, 'review_required', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_fina, v_order_fina, 'review_required', 'review_required', 'full_capture_financial_state_requires_review', NULL),
    (v_refund_finb, v_order_finb, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_finfull, v_order_finc, 'review_required', 'review_required', 'full_capture_transaction_requires_review', NULL),
    (v_refund_finpart, v_order_finc, 'review_required', 'review_required', 'partial_units_require_fulfillment_reconciliation', NULL);
  INSERT INTO public.variant_inventory
    (id, merchant_id, variant_id, order_id, order_item_id, branch_id, status,
     identifier_type, identifier_value, reserved_at)
  VALUES
    (v_unit_flip1, v_merchant, v_variant_flip, v_order_flip, v_item_flip, NULL, 'reserved',
     'serial', 'R31P1-FLIP-1', pg_catalog.now() - interval '1 hour'),
    (v_unit_flip2, v_merchant, v_variant_flip, v_order_flip, v_item_flip, NULL, 'reserved',
     'serial', 'R31P1-FLIP-2', pg_catalog.now() - interval '1 hour'),
    (v_unit_strict1, v_merchant, v_variant_strict, v_order_strict, v_item_strict, NULL, 'reserved',
     'serial', 'R31P1-STRICT-1', pg_catalog.now() - interval '1 hour'),
    (v_unit_strict2, v_merchant, v_variant_strict, v_order_strict, v_item_strict, NULL, 'reserved',
     'serial', 'R31P1-STRICT-2', pg_catalog.now() - interval '1 hour'),
    (v_unit_cancelc1, v_merchant, v_variant_cancelc, v_order_cancelc, v_item_cancelc, NULL, 'reserved',
     'serial', 'R31P1-CANCELC-1', pg_catalog.now() - interval '1 hour'),
    (v_unit_cancelc2, v_merchant, v_variant_cancelc, v_order_cancelc, v_item_cancelc, NULL, 'reserved',
     'serial', 'R31P1-CANCELC-2', pg_catalog.now() - interval '1 hour'),
    (v_unit_cancelg1, v_merchant, v_variant_cancelg, v_order_cancelg, v_item_cancelg, NULL, 'reserved',
     'serial', 'R31P1-CANCELG-1', pg_catalog.now() - interval '1 hour'),
    (v_unit_cancelg2, v_merchant, v_variant_cancelg, v_order_cancelg, v_item_cancelg, NULL, 'reserved',
     'serial', 'R31P1-CANCELG-2', pg_catalog.now() - interval '1 hour');
  INSERT INTO private.variant_inventory_events
    (inventory_unit_id, merchant_id, product_id, variant_id, event_type,
     from_status, to_status, order_id, order_item_id)
  VALUES
    (v_unit_flip1, v_merchant, v_product_flip, v_variant_flip, 'reserved',
     'available', 'reserved', v_order_flip, v_item_flip),
    (v_unit_flip2, v_merchant, v_product_flip, v_variant_flip, 'reserved',
     'available', 'reserved', v_order_flip, v_item_flip),
    (v_unit_strict1, v_merchant, v_product_strict, v_variant_strict, 'reserved',
     'available', 'reserved', v_order_strict, v_item_strict),
    (v_unit_strict2, v_merchant, v_product_strict, v_variant_strict, 'reserved',
     'available', 'reserved', v_order_strict, v_item_strict);
  INSERT INTO public.reconciliation_review
    (issue_type, order_id, reason, metadata)
  VALUES
    ('serialized_inventory_confirmation_failed', v_order_fina, 'full_capture_financial_state_requires_review',
     jsonb_build_object('refundId', v_refund_fina, 'refundIds', jsonb_build_array(v_refund_fina))),
    ('serialized_inventory_confirmation_failed', v_order_finb, 'inventory_release_requires_review',
     jsonb_build_object('refundId', v_refund_finb, 'refundIds', jsonb_build_array(v_refund_finb))),
    ('serialized_inventory_confirmation_failed', v_order_finc, 'partial_units_require_fulfillment_reconciliation',
     jsonb_build_object('refundId', v_refund_finpart,
       'refundIds', jsonb_build_array(v_refund_finfull, v_refund_finpart)));
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (order-time policy): flip the catalog policy to off AFTER the
  -- order reserved its units. The partial still releases through
  -- BOTH paths (mixed_units): stock restocks (the sync only touches
  -- currently-serialized products) and the unit frees (no strand).
  UPDATE public.products SET inventory_tracking_policy = 'off' WHERE id = v_product_flip;
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_flip) INTO v_receipt;
  IF (v_receipt->>'releasePath') <> 'mixed_units' THEN
    RAISE EXCEPTION 'flipped line resolved via %, want mixed_units', v_receipt->>'releasePath';
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant_flip;
  IF v_stock <> 11 THEN RAISE EXCEPTION 'flipped line restocked to %, want 11', v_stock; END IF;
  SELECT status INTO v_state FROM public.variant_inventory WHERE id = v_unit_flip1;
  IF v_state <> 'available' THEN RAISE EXCEPTION 'flipped unit %, want available', v_state; END IF;
  SELECT count(*) INTO v_qty FROM public.variant_inventory
  WHERE order_item_id = v_item_flip AND status = 'reserved';
  IF v_qty <> 1 THEN RAISE EXCEPTION 'flipped line has % reserved, want 1', v_qty; END IF;

  -- Still-serialized control: unit release only, no quantity restock.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_strict) INTO v_receipt;
  IF (v_receipt->>'releasePath') <> 'refund_units' THEN
    RAISE EXCEPTION 'strict line resolved via %, want refund_units', v_receipt->>'releasePath';
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant_strict;
  IF v_stock <> 10 THEN RAISE EXCEPTION 'strict line restocked to %, want 10', v_stock; END IF;
  SELECT count(*) INTO v_qty FROM public.variant_inventory
  WHERE order_item_id = v_item_strict AND status = 'reserved';
  IF v_qty <> 1 THEN RAISE EXCEPTION 'strict line has % reserved, want 1', v_qty; END IF;

  -- Never-serialized control: quantity path only.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_qty) INTO v_receipt;
  IF (v_receipt->>'releasePath') <> 'quantity_units' THEN
    RAISE EXCEPTION 'qty line resolved via %, want quantity_units', v_receipt->>'releasePath';
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 11 THEN RAISE EXCEPTION 'qty line restocked to %, want 11', v_stock; END IF;

  -- P1 (cancel restock): customer-cancel a serialized order. The
  -- trigger frees the units; the explicit restock must not add the
  -- line quantity again.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text)::text, true);
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cancelc, 'changed mind') INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'serialized cancel did not succeed'; END IF;
  SELECT count(*) INTO v_qty FROM public.variant_inventory
  WHERE id IN (v_unit_cancelc1, v_unit_cancelc2) AND status = 'available';
  IF v_qty <> 2 THEN RAISE EXCEPTION 'cancel freed % units, want 2', v_qty; END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant_cancelc;
  IF v_stock <> 10 THEN RAISE EXCEPTION 'cancel restocked serialized to %, want 10', v_stock; END IF;
  -- Quantity lines on the same path still restock in full.
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cancelq, 'changed mind') INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'quantity cancel did not succeed'; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_cancelq;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'cancel restocked quantity to %, want 12', v_stock; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Guest REDVAULT branch: same exclusion for serialized lines.
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SELECT public.cancel_storefront_order_as_guest(v_order_cancelg, 'track-r31-cancelg', 'changed mind')
  INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'guest serialized cancel did not succeed'; END IF;
  SELECT count(*) INTO v_qty FROM public.variant_inventory
  WHERE id IN (v_unit_cancelg1, v_unit_cancelg2) AND status = 'available';
  IF v_qty <> 2 THEN RAISE EXCEPTION 'guest cancel freed % units, want 2', v_qty; END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant_cancelg;
  IF v_stock <> 10 THEN RAISE EXCEPTION 'guest cancel restocked serialized to %, want 10', v_stock; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (financial review): inventory resolves but the shared review
  -- stays open while full_capture finance is unresolved, and the
  -- financial reason survives for later resolutions.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_fina) INTO v_receipt;
  SELECT inventory_state, review_reason INTO v_state, v_reason
  FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund_fina;
  IF v_state <> 'released' THEN RAISE EXCEPTION 'fina inventory %, want released', v_state; END IF;
  IF v_reason <> 'full_capture_financial_state_requires_review' THEN
    RAISE EXCEPTION 'fina reason cleared, want the financial reason preserved';
  END IF;
  SELECT resolved_at INTO v_resolved FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed' AND order_id = v_order_fina;
  IF v_resolved IS NOT NULL THEN RAISE EXCEPTION 'fina review closed despite unresolved finance'; END IF;
  -- Finance-reconciled control closes normally and clears its reason.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_finb) INTO v_receipt;
  SELECT review_reason INTO v_reason
  FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund_finb;
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'finb reason %, want NULL', v_reason; END IF;
  SELECT resolved_at INTO v_resolved FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed' AND order_id = v_order_finb;
  IF v_resolved IS NULL THEN RAISE EXCEPTION 'finb review stayed open despite clean finance'; END IF;
  -- A later partial resolution cannot bury the earlier full's finance.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_finfull) INTO v_receipt;
  SELECT resolved_at INTO v_resolved FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed' AND order_id = v_order_finc;
  IF v_resolved IS NOT NULL THEN RAISE EXCEPTION 'finc review closed on full resolve'; END IF;
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_finpart) INTO v_receipt;
  SELECT resolved_at INTO v_resolved FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed' AND order_id = v_order_finc;
  IF v_resolved IS NOT NULL THEN RAISE EXCEPTION 'finc review closed on partial resolve'; END IF;

  -- P2 (reserve lock order): reservation still succeeds and holds the
  -- order advisory lock; unknown attempts reject up front.
  SELECT count(*) INTO v_locks_before FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(v_attempt_rsv, v_merchant,
    'R31P1-RSV', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item_rsv::text, 'unitOrdinal', 1)));
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'reservation did not succeed, got %', v_state;
  END IF;
  SELECT count(*) INTO v_locks_after FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  IF v_locks_after <= v_locks_before THEN
    RAISE EXCEPTION 'reservation did not acquire the order advisory lock';
  END IF;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(gen_random_uuid(), v_merchant,
      'R31P1-MISSING', 'merchandise_units',
      jsonb_build_array(jsonb_build_object('orderItemId', v_item_rsv::text, 'unitOrdinal', 2)));
    RAISE EXCEPTION 'reservation on a missing attempt unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_attempt_not_found' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
