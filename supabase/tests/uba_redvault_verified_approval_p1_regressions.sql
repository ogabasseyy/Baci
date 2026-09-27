-- Round-6 P1 regressions for REDVAULT verified approval:
-- a scoped storefront route client can complete approval through the
-- narrowly scoped completion primitive, and approval persists the full
-- canonical gateway evidence (reference, amount, currency, status, paid_at)
-- instead of a paid_at-only object that later verifications mistake for
-- cached provider evidence.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_a uuid := '10000000-0000-4000-8000-000000000011';
  v_order_b uuid := '10000000-0000-4000-8000-000000000012';
  v_product uuid := 'b0000000-0000-4000-8000-000000000011';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000011';
  v_item_a uuid := '20000000-0000-4000-8000-000000000011';
  v_item_b uuid := '20000000-0000-4000-8000-000000000012';
  v_application_a uuid := 'd1000000-0000-4000-8000-000000000011';
  v_application_b uuid := 'd1000000-0000-4000-8000-000000000012';
  v_attempt_a uuid := 'd2000000-0000-4000-8000-000000000011';
  v_attempt_b uuid := 'd2000000-0000-4000-8000-000000000012';
  v_transaction_a uuid := 'd3000000-0000-4000-8000-000000000011';
  v_transaction_b uuid := 'd3000000-0000-4000-8000-000000000012';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000011';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object(
    'bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_policy_hash text := encode(extensions.digest(v_policy::text, 'sha256'), 'hex');
  v_evidence_a jsonb;
  v_evidence_b jsonb;
  v_receipt jsonb;
  v_gateway jsonb;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p6@example.com', 'Redvault P6')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes
    (id, merchant_id, code, discount_type, discount_value, usage_limit, usage_limit_per_customer)
  VALUES (v_discount, v_merchant, 'R6P1', 'fixed_amount', 100, 1000000, 1000000);
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P6 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy)
  VALUES (v_variant, v_product, v_merchant, 'inherit');

  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, customer_email)
  VALUES (v_order_a, v_merchant, 'R6P1-A', 1500.00, 'uba_redvault', 'redvault-p6@example.com'),
         (v_order_b, v_merchant, 'R6P1-B', 1500.00, 'uba_redvault', 'redvault-p6@example.com');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_a, v_order_a, v_product, v_variant, 'Redvault P6 item a', 150000, 1),
         (v_item_b, v_order_b, v_product, v_variant, 'Redvault P6 item b', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES
    ('a0000000-0000-4000-8000-000000000011', v_merchant, v_order_a, v_item_a, v_variant, 'reserved', 'serial', 'R6P1-001'),
    ('a0000000-0000-4000-8000-000000000012', v_merchant, v_order_b, v_item_b, v_variant, 'reserved', 'serial', 'R6P1-002');

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
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_a, v_order_a, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p6@example.com', 'R6P1-A', 'R6P1-A', 100, 150000, 'pending'),
    (v_application_b, v_order_b, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p6@example.com', 'R6P1-B', 'R6P1-B', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, provider_response,
     accepted_filter_policy, accepted_filter_policy_hash)
  VALUES
    (v_attempt_a, v_application_a, v_order_a, v_merchant, 'R6P1-ATTEMPT-A', v_hash,
     150000, 'NGN', 'captured_held', jsonb_build_object(
       'capture_amount_kobo', '150000', 'capture_reference', 'R6P1-ATTEMPT-A',
       'capture_currency', 'NGN', 'capture_status', 'success'),
     v_policy, v_policy_hash),
    (v_attempt_b, v_application_b, v_order_b, v_merchant, 'R6P1-ATTEMPT-B', v_hash,
     150000, 'NGN', 'captured_held', jsonb_build_object(
       'capture_amount_kobo', '150000', 'capture_reference', 'R6P1-ATTEMPT-B',
       'capture_currency', 'NGN', 'capture_status', 'success'),
     v_policy, v_policy_hash);
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    (v_transaction_a, v_merchant, v_order_a, 'payment', 1500.00, 'NGN', 'pending', 'paystack', 'R6P1-ATTEMPT-A', NULL),
    (v_transaction_b, v_merchant, v_order_b, 'payment', 1500.00, 'NGN', 'pending', 'paystack', 'R6P1-ATTEMPT-B', NULL);

  v_evidence_a := jsonb_build_object(
    'acceptedFilterPolicyHash', v_policy_hash, 'amountKobo', 150000,
    'cardBrand', 'verve', 'cardChannel', 'card',
    'contractVersion', 'paystack_verified_card_v1', 'currency', 'NGN',
    'customerEmail', 'redvault-p6@example.com', 'domain', 'test',
    'issuerName', 'GTBank', 'providerVerificationId', 'R6P1-PROV-A',
    'reference', 'R6P1-ATTEMPT-A',
    'verificationSource', 'paystack_transaction_verify',
    'verifiedAt', '2026-01-01T00:00:00Z');
  v_evidence_b := jsonb_build_object(
    'acceptedFilterPolicyHash', v_policy_hash, 'amountKobo', 150000,
    'cardBrand', 'visa', 'cardChannel', 'card',
    'contractVersion', 'paystack_verified_card_v1', 'currency', 'NGN',
    'customerEmail', 'redvault-p6@example.com', 'domain', 'test',
    'issuerName', 'GTBank', 'providerVerificationId', 'R6P1-PROV-B',
    'reference', 'R6P1-ATTEMPT-B',
    'verificationSource', 'paystack_transaction_verify',
    'verifiedAt', '2026-01-01T00:00:00Z');

  -- P1 (scoped completion): the merchant-bound scoped route client completes
  -- approval instead of rolling back in the nested service_role-only call.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74')::text, true);
  v_receipt := public.approve_and_complete_uba_redvault_payment(
    v_transaction_a, v_order_a, v_evidence_a);
  IF (v_receipt->>'duplicate') <> 'false' OR (v_receipt->>'kind') <> 'approved' THEN
    RAISE EXCEPTION 'scoped approval did not complete: %', v_receipt;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF (SELECT payment_status FROM public.orders WHERE id = v_order_a) <> 'paid' THEN
    RAISE EXCEPTION 'scoped approval did not mark the order paid';
  END IF;
  IF (SELECT status FROM public.transactions WHERE id = v_transaction_a) <> 'completed' THEN
    RAISE EXCEPTION 'scoped approval did not complete the transaction';
  END IF;

  -- P1 (gateway evidence): approval persists the full canonical evidence so a
  -- later verification cannot mistake it for cached provider evidence.
  v_receipt := public.approve_and_complete_uba_redvault_payment(
    v_transaction_b, v_order_b, v_evidence_b);
  IF (v_receipt->>'duplicate') <> 'false' OR (v_receipt->>'kind') <> 'approved' THEN
    RAISE EXCEPTION 'service approval did not complete: %', v_receipt;
  END IF;
  SELECT gateway_response INTO v_gateway FROM public.transactions WHERE id = v_transaction_b;
  IF (v_gateway->>'reference') <> 'R6P1-ATTEMPT-B'
    OR (v_gateway->>'amount')::bigint <> 150000
    OR (v_gateway->>'currency') <> 'NGN'
    OR (v_gateway->>'status') <> 'success'
    OR (v_gateway->>'paid_at') IS NULL THEN
    RAISE EXCEPTION 'partial gateway evidence persisted: %', v_gateway;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
