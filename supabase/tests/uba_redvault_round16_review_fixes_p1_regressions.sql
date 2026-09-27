-- Round-16 regressions: the base refund-reservation aggregate counts
-- indeterminate refunds; abandoned cleanup pre-locks REDVAULT candidates so
-- it cannot deadlock approval; guests cancel guest-owned orders by tracking
-- token while attached/stranger orders stay untouched.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000b6';
  v_guest_email text := 'redvault-guest-p16@example.com';
  v_customer_guest uuid := '22222222-0000-4000-8000-0000000000b6';
  v_customer_owned uuid := '22222222-0000-4000-8000-0000000000b7';
  v_order_refund uuid := '10000000-0000-4000-8000-0000000000b1';
  v_order_stale uuid := '10000000-0000-4000-8000-0000000000b2';
  v_order_held uuid := '10000000-0000-4000-8000-0000000000b3';
  v_order_stale_card uuid := '10000000-0000-4000-8000-0000000000b4';
  v_order_guest_rv uuid := '10000000-0000-4000-8000-0000000000b5';
  v_order_guest_card uuid := '10000000-0000-4000-8000-0000000000b6';
  v_order_owned uuid := '10000000-0000-4000-8000-0000000000b7';
  v_order_live uuid := '10000000-0000-4000-8000-0000000000b8';
  v_application_refund uuid := 'd1000000-0000-4000-8000-0000000000b1';
  v_application_held uuid := 'd1000000-0000-4000-8000-0000000000b3';
  v_application_guest_rv uuid := 'd1000000-0000-4000-8000-0000000000b5';
  v_application_live uuid := 'd1000000-0000-4000-8000-0000000000b8';
  v_attempt_refund uuid := 'd2000000-0000-4000-8000-0000000000b1';
  v_attempt_held uuid := 'd2000000-0000-4000-8000-0000000000b3';
  v_attempt_live uuid := 'd2000000-0000-4000-8000-0000000000b8';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000b6';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000b6';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000b6';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000b6';
  v_item uuid := '20000000-0000-4000-8000-0000000000b5';
  v_unit uuid := '30000000-0000-4000-8000-0000000000b5';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_policy_hash text := encode(extensions.digest(v_policy::text, 'sha256'), 'hex');
  v_state text;
  v_payment text;
  v_shipping text;
  v_cancelled boolean;
  v_unit_status text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p16@example.com', 'Redvault P16')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R16P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P16 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer_guest, v_merchant, NULL, v_guest_email),
         (v_customer_owned, v_merchant, v_user, 'redvault-owned-p16@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, tracking_token, total, payment_method, payment_status,
     shipping_status, created_at)
  VALUES
    (v_order_refund, v_merchant, v_customer_guest, 'R16P1-REFUND', 'R16P1-TOKEN-REFUND', 1500.00,
     'uba_redvault', 'paid', 'processing', pg_catalog.now() - interval '10 minutes'),
    (v_order_stale, v_merchant, v_customer_guest, 'R16P1-STALE', 'R16P1-TOKEN-STALE', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_held, v_merchant, v_customer_guest, 'R16P1-HELD', 'R16P1-TOKEN-HELD', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_stale_card, v_merchant, v_customer_guest, 'R16P1-STALECARD', 'R16P1-TOKEN-STALECARD', 1500.00,
     'card', 'unpaid', 'pending', pg_catalog.now() - interval '80 hours'),
    (v_order_guest_rv, v_merchant, v_customer_guest, 'R16P1-GUESTRV', 'R16P1-TOKEN-GUESTRV', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_guest_card, v_merchant, v_customer_guest, 'R16P1-GUESTCARD', 'R16P1-TOKEN-GUESTCARD', 1500.00,
     'card', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_owned, v_merchant, v_customer_owned, 'R16P1-OWNED', 'R16P1-TOKEN-OWNED', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes'),
    (v_order_live, v_merchant, v_customer_guest, 'R16P1-LIVE', 'R16P1-TOKEN-LIVE', 1500.00,
     'uba_redvault', 'unpaid', 'pending', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order_guest_rv, v_product, v_variant, 'Redvault P16 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES (v_unit, v_merchant, v_order_guest_rv, v_item, v_variant,
    'reserved', 'serial', 'R16P1-001');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_refund, v_order_refund, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p16@example.com', 'R16P1-REFUND', 'R16P1-REFUND', 100, 150000, 'pending', v_user),
    (v_application_held, v_order_held, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R16P1-HELD', 'R16P1-HELD', 100, 150000, 'pending', NULL),
    (v_application_guest_rv, v_order_guest_rv, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R16P1-GUESTRV', 'R16P1-GUESTRV', 100, 150000, 'pending', NULL),
    (v_application_live, v_order_live, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R16P1-LIVE', 'R16P1-LIVE', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_refund, v_application_refund, v_order_refund, v_merchant, 'R16P1-ATTEMPT-REFUND', v_hash,
     150000, 'NGN', 'approved', v_policy, v_policy_hash, 'ACCT_r16p1', 0, NULL,
     '{"capture_reference":"R16P1-ATTEMPT-REFUND","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_held, v_application_held, v_order_held, v_merchant, 'R16P1-ATTEMPT-HELD', v_hash,
     150000, 'NGN', 'initialized', v_policy, v_policy_hash, 'ACCT_r16p1', 0,
     'https://checkout.paystack.com/r16p1-held', NULL),
    (v_attempt_live, v_application_live, v_order_live, v_merchant, 'R16P1-ATTEMPT-LIVE', v_hash,
     150000, 'NGN', 'initialized', v_policy, v_policy_hash, 'ACCT_r16p1', 0,
     'https://checkout.paystack.com/r16p1-live', NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- B3 (indeterminate reservation): a needs_reconciliation full_capture
  -- keeps its amount reserved in the base RPC; a second key cannot reserve
  -- the capture again, while failed refunds stay retryable.
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(
    v_attempt_refund, v_merchant, 'R16P1-FIRST', 'full_capture');
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'first full_capture did not reserve, got %', v_state;
  END IF;
  PERFORM public.claim_next_uba_redvault_refund();
  UPDATE private.uba_redvault_refunds
  SET state = 'needs_reconciliation', updated_at = pg_catalog.now()
  WHERE attempt_id = v_attempt_refund AND idempotency_key = 'R16P1-FIRST';
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(
      v_attempt_refund, v_merchant, 'R16P1-SECOND', 'full_capture');
    RAISE EXCEPTION 'double full_capture reservation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_full_refund_unavailable' THEN RAISE; END IF;
  END;
  UPDATE private.uba_redvault_refunds
  SET state = 'failed', updated_at = pg_catalog.now()
  WHERE attempt_id = v_attempt_refund AND idempotency_key = 'R16P1-FIRST';
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(
    v_attempt_refund, v_merchant, 'R16P1-RETRY', 'full_capture');
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'failed-refund retry did not reserve, got %', v_state;
  END IF;

  -- A2 (cleanup serialization): the batch still cancels a stale bare draft
  -- and a stale ordinary order, while a held draft keeps its unpaid state.
  -- The advisory pre-lock runs before the batch UPDATE (same lock order as
  -- payment paths), so approval can no longer deadlock the batch.
  PERFORM public.mark_abandoned_orders();
  SELECT payment_status, shipping_status INTO v_payment, v_shipping
  FROM public.orders WHERE id = v_order_stale;
  IF v_payment <> 'cancelled' THEN
    RAISE EXCEPTION 'stale draft was not cancelled, got %/%', v_payment, v_shipping;
  END IF;
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_stale_card;
  IF v_payment <> 'cancelled' THEN
    RAISE EXCEPTION 'stale ordinary order was not cancelled, got %', v_payment;
  END IF;
  SELECT payment_status INTO v_payment FROM public.orders WHERE id = v_order_held;
  IF v_payment <> 'unpaid' THEN
    RAISE EXCEPTION 'held draft was cancelled, got %', v_payment;
  END IF;

  -- Guest cancel (mobile review / lane switch): token-bound, guest-owned
  -- only, idempotent, and fenced units release through the shared trigger.
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SELECT public.cancel_storefront_order_as_guest(
    v_order_guest_rv, 'R16P1-TOKEN-GUESTRV', 'guest switched lanes') INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'guest REDVAULT cancel did not cancel';
  END IF;
  SELECT payment_status, shipping_status INTO v_payment, v_shipping
  FROM public.orders WHERE id = v_order_guest_rv;
  IF v_payment <> 'cancelled' OR v_shipping <> 'cancelled' THEN
    RAISE EXCEPTION 'guest REDVAULT order not cancelled, got %/%', v_payment, v_shipping;
  END IF;
  SELECT status INTO v_unit_status FROM public.variant_inventory WHERE id = v_unit;
  IF v_unit_status <> 'available' THEN
    RAISE EXCEPTION 'fenced unit was not released, got %', v_unit_status;
  END IF;
  SELECT public.cancel_storefront_order_as_guest(
    v_order_guest_rv, 'R16P1-TOKEN-GUESTRV', null) INTO v_cancelled;
  IF v_cancelled IS NOT FALSE THEN
    RAISE EXCEPTION 'repeat guest cancel was not a no-op';
  END IF;
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(
      v_order_guest_card, 'WRONG-TOKEN', null);
    RAISE EXCEPTION 'wrong-token guest cancel unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(
      v_order_owned, 'R16P1-TOKEN-OWNED', null);
    RAISE EXCEPTION 'attached-order guest cancel unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(
      v_order_live, 'R16P1-TOKEN-LIVE', null);
    RAISE EXCEPTION 'live-attempt guest cancel unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_guest_cancel_active' THEN RAISE; END IF;
  END;
  SELECT public.cancel_storefront_order_as_guest(
    v_order_guest_card, 'R16P1-TOKEN-GUESTCARD', null) INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'guest ordinary cancel did not cancel';
  END IF;
  SELECT shipping_status INTO v_shipping FROM public.orders WHERE id = v_order_guest_card;
  IF v_shipping <> 'cancelled' THEN
    RAISE EXCEPTION 'guest ordinary order not cancelled, got %', v_shipping;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
