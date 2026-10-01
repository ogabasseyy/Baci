-- Round-26 P1 regressions: guest attach is idempotent for the owning
-- caller (a retry after a successful attach still succeeds instead of
-- reporting false and triggering guest-context recovery), while a
-- different caller still gets false; the inventory review resolver
-- dispatches full-capture refunds to the full-order release path instead
-- of the partial-unit helper that always rejects them.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000a1';
  v_other uuid := '33333333-0000-4000-8000-0000000000a1';
  v_guest_email text := 'redvault-guest-p26@example.com';
  v_customer uuid := '22222222-0000-4000-8000-0000000000a1';
  v_order_guest uuid := '10000000-0000-4000-8000-0000000000a1';
  v_order_full uuid := '10000000-0000-4000-8000-0000000000a2';
  v_order_ship uuid := '10000000-0000-4000-8000-0000000000a3';
  v_application_guest uuid := 'd1000000-0000-4000-8000-0000000000a1';
  v_application_full uuid := 'd1000000-0000-4000-8000-0000000000a2';
  v_application_ship uuid := 'd1000000-0000-4000-8000-0000000000a3';
  v_attempt_full uuid := 'd2000000-0000-4000-8000-0000000000a2';
  v_attempt_ship uuid := 'd2000000-0000-4000-8000-0000000000a3';
  v_refund_full uuid := 'd3000000-0000-4000-8000-0000000000a2';
  v_refund_ship uuid := 'd3000000-0000-4000-8000-0000000000a3';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000a1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000a1';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000a1';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000a1';
  v_item uuid := '20000000-0000-4000-8000-0000000000a2';
  v_unit uuid := '30000000-0000-4000-8000-0000000000a2';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_attached boolean;
  v_receipt jsonb;
  v_state text;
  v_status text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p26@example.com', 'Redvault P26')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R26P1', 'fixed_amount', 100);
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
  -- A non-serialized line is exactly why finalization queues a full
  -- review instead of auto-releasing: the resolver must still resolve it.
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P26 product', 150000, true, 'simple');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, v_guest_email);

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_guest, v_merchant, v_customer, 'R26P1-GUEST', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'track-r26-guest', pg_catalog.now() - interval '10 minutes'),
    (v_order_full, v_merchant, v_customer, 'R26P1-FULL', 1500.00, 'uba_redvault', 'refunded', 'pending',
     'track-r26-full', pg_catalog.now() - interval '10 minutes'),
    (v_order_ship, v_merchant, v_customer, 'R26P1-SHIP', 1500.00, 'uba_redvault', 'refunded', 'shipped',
     'track-r26-ship', pg_catalog.now() - interval '10 minutes');
  UPDATE public.orders SET shipped_at = pg_catalog.now() - interval '1 hour' WHERE id = v_order_ship;
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order_full, v_product, v_variant, 'Redvault P26 item', 150000, 1);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_guest, v_order_guest, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R26P1-GUEST', 'R26P1-GUEST', 100, 150000, 'pending', NULL),
    (v_application_full, v_order_full, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R26P1-FULL', 'R26P1-FULL', 100, 150000, 'pending', NULL),
    (v_application_ship, v_order_ship, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, v_guest_email, 'R26P1-SHIP', 'R26P1-SHIP', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_full, v_application_full, v_order_full, v_merchant, 'R26P1-ATTEMPT-FULL', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r26p1', 0, NULL,
     '{"capture_reference":"R26P1-ATTEMPT-FULL","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_ship, v_application_ship, v_order_ship, v_merchant, 'R26P1-ATTEMPT-SHIP', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r26p1', 0, NULL,
     '{"capture_reference":"R26P1-ATTEMPT-SHIP","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES
    (v_refund_full, v_attempt_full, 'R26P1-FULL', 150000, 'processed', 'full_capture'),
    (v_refund_ship, v_attempt_ship, 'R26P1-SHIP', 150000, 'processed', 'full_capture');
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES
    (v_refund_full, v_order_full, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_ship, v_order_ship, 'refunded', 'review_required', 'inventory_release_requires_review', NULL);
  INSERT INTO public.reconciliation_review (issue_type, order_id, reason, metadata)
  VALUES ('serialized_inventory_confirmation_failed', v_order_full, 'REDVAULT refund inventory requires review',
    jsonb_build_object('refundId', v_refund_full, 'refundIds', jsonb_build_array(v_refund_full)));
  INSERT INTO public.variant_inventory
    (id, merchant_id, variant_id, order_id, order_item_id, branch_id, status,
     identifier_type, identifier_value, reserved_at)
  VALUES (v_unit, v_merchant, v_variant, v_order_full, v_item, NULL, 'reserved',
    'serial', 'R26P1-UNIT-1', pg_catalog.now() - interval '1 hour');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (attach idempotency): the owning caller re-attaching gets true;
  -- a different caller still gets false.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', v_user::text, 'email', v_guest_email)::text, true);
  SELECT public.attach_redvault_guest_application_to_customer(v_order_guest, 'track-r26-guest')
    INTO v_attached;
  IF v_attached IS NOT TRUE THEN
    RAISE EXCEPTION 'guest checkout was not attached';
  END IF;
  SELECT public.attach_redvault_guest_application_to_customer(v_order_guest, 'track-r26-guest')
    INTO v_attached;
  IF v_attached IS NOT TRUE THEN
    RAISE EXCEPTION 'owning caller re-attach was not idempotent';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', v_other::text, 'email', v_guest_email)::text, true);
  SELECT public.attach_redvault_guest_application_to_customer(v_order_guest, 'track-r26-guest')
    INTO v_attached;
  IF v_attached IS NOT FALSE THEN
    RAISE EXCEPTION 'attach was not single-claim';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (full-capture review resolution): the resolver releases the
  -- order's reserved units through the full-order path and closes the
  -- lifecycle row and the shared order review.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_full) INTO v_receipt;
  IF (v_receipt->>'success')::boolean IS DISTINCT FROM true
    OR v_receipt->>'releasePath' <> 'full_order'
    OR v_receipt->>'inventoryState' <> 'released' THEN
    RAISE EXCEPTION 'full-capture review did not resolve, got %', v_receipt;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory WHERE id = v_unit;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'reserved unit was not released, got %', v_status;
  END IF;
  SELECT inventory_state INTO v_state FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = v_refund_full;
  IF v_state <> 'released' THEN
    RAISE EXCEPTION 'lifecycle row was not released, got %', v_state;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reconciliation_review
                 WHERE order_id = v_order_full AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shared order review was not resolved';
  END IF;

  -- The shipment-state gates still fail closed: a shipped order keeps
  -- its review open instead of releasing inventory for sent goods.
  BEGIN
    PERFORM public.resolve_uba_redvault_refund_inventory_review(v_refund_ship);
    RAISE EXCEPTION 'shipped full-capture review unexpectedly resolved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_full_refund_inventory_requires_review' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
