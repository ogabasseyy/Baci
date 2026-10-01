-- Round-28 P1 regressions: the payment snapshot no longer discloses the
-- tracking token (ownership proof moves to a boolean RPC), REDVAULT
-- cancellation restocks quantity-managed stock, and partial-refund
-- inventory resolution restores quantity stock plus the surviving
-- shippable count for non-serialized lines (in both the review resolver
-- and processed-refund finalization).
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000c1';
  v_customer_user uuid := '22222222-0000-4000-8000-0000000000c1';
  v_customer_guest uuid := '22222222-0000-4000-8000-0000000000c2';
  v_order_cancel uuid := '10000000-0000-4000-8000-0000000000c1';
  v_order_guest uuid := '10000000-0000-4000-8000-0000000000c2';
  v_order_qty uuid := '10000000-0000-4000-8000-0000000000c3';
  v_order_mixed uuid := '10000000-0000-4000-8000-0000000000c4';
  v_order_final uuid := '10000000-0000-4000-8000-0000000000c5';
  v_application_qty uuid := 'd1000000-0000-4000-8000-0000000000c3';
  v_application_mixed uuid := 'd1000000-0000-4000-8000-0000000000c4';
  v_application_final uuid := 'd1000000-0000-4000-8000-0000000000c5';
  v_attempt_qty uuid := 'd2000000-0000-4000-8000-0000000000c3';
  v_attempt_mixed uuid := 'd2000000-0000-4000-8000-0000000000c4';
  v_attempt_final uuid := 'd2000000-0000-4000-8000-0000000000c5';
  v_refund_qty uuid := 'd3000000-0000-4000-8000-0000000000c3';
  v_refund_mixed uuid := 'd3000000-0000-4000-8000-0000000000c4';
  v_refund_final uuid := 'd3000000-0000-4000-8000-0000000000c5';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000c1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000c1';
  v_product_qty uuid := 'b0000000-0000-4000-8000-0000000000c1';
  v_product_ser uuid := 'b0000000-0000-4000-8000-0000000000c2';
  v_variant_ser uuid := 'c0000000-0000-4000-8000-0000000000c2';
  v_item_cancel uuid := '20000000-0000-4000-8000-0000000000c1';
  v_item_guest uuid := '20000000-0000-4000-8000-0000000000c2';
  v_item_qty uuid := '20000000-0000-4000-8000-0000000000c3';
  v_item_mixed_qty uuid := '20000000-0000-4000-8000-0000000000c4';
  v_item_mixed_ser uuid := '20000000-0000-4000-8000-0000000000c5';
  v_item_final uuid := '20000000-0000-4000-8000-0000000000c6';
  v_unit uuid := '30000000-0000-4000-8000-0000000000c4';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_evidence jsonb := '{"capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success"}'::jsonb;
  v_ok boolean;
  v_snapshot jsonb;
  v_receipt jsonb;
  v_stock integer;
  v_state text;
  v_qty integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name, country)
  VALUES (v_merchant, 'redvault-p28@example.com', 'Redvault P28', 'NG')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R28P1', 'fixed_amount', 100);
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
    (v_product_qty, v_merchant, 'Redvault P28 quantity', 75000, false, 'simple', true, 10),
    (v_product_ser, v_merchant, 'Redvault P28 serialized', 75000, true, 'serialized_strict', false, 0);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant_ser, v_product_ser, v_merchant, 'inherit', '{"color":"red"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES
    (v_customer_user, v_merchant, v_user, 'redvault-owner-p28@example.com'),
    (v_customer_guest, v_merchant, NULL, 'redvault-guest-p28@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, customer_email, order_number, total, currency, payment_method,
     payment_status, shipping_status, tracking_token, created_at)
  VALUES
    (v_order_cancel, v_merchant, v_customer_user, 'redvault-owner-p28@example.com', 'R28P1-CANCEL',
     1500.00, 'NGN', 'uba_redvault', 'unpaid', 'pending', 'track-r28-cancel',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_guest, v_merchant, v_customer_guest, 'redvault-guest-p28@example.com', 'R28P1-GUEST',
     1500.00, 'NGN', 'uba_redvault', 'unpaid', 'pending', 'track-r28-guest',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_qty, v_merchant, v_customer_guest, 'redvault-guest-p28@example.com', 'R28P1-QTY',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r28-qty',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_mixed, v_merchant, v_customer_guest, 'redvault-guest-p28@example.com', 'R28P1-MIXED',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r28-mixed',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_final, v_merchant, v_customer_guest, 'redvault-guest-p28@example.com', 'R28P1-FINAL',
     1500.00, 'NGN', 'uba_redvault', 'paid', 'pending', 'track-r28-final',
     pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES
    (v_item_cancel, v_order_cancel, v_product_qty, NULL, 'Redvault P28 cancel item', 75000, 2),
    (v_item_guest, v_order_guest, v_product_qty, NULL, 'Redvault P28 guest item', 75000, 2),
    (v_item_qty, v_order_qty, v_product_qty, NULL, 'Redvault P28 qty item', 75000, 2),
    (v_item_mixed_qty, v_order_mixed, v_product_qty, NULL, 'Redvault P28 mixed qty item', 75000, 2),
    (v_item_mixed_ser, v_order_mixed, v_product_ser, v_variant_ser, 'Redvault P28 mixed ser item', 75000, 1),
    (v_item_final, v_order_final, v_product_qty, NULL, 'Redvault P28 final item', 75000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_qty, v_order_qty, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-guest-p28@example.com', 'R28P1-QTY', 'R28P1-QTY', 100, 150000, 'pending', NULL),
    (v_application_mixed, v_order_mixed, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-guest-p28@example.com', 'R28P1-MIXED', 'R28P1-MIXED', 100, 150000, 'pending', NULL),
    (v_application_final, v_order_final, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-guest-p28@example.com', 'R28P1-FINAL', 'R28P1-FINAL', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_qty, v_application_qty, v_order_qty, v_merchant, 'R28P1-ATTEMPT-QTY', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r28p1', 0, NULL, v_evidence),
    (v_attempt_mixed, v_application_mixed, v_order_mixed, v_merchant, 'R28P1-ATTEMPT-MIXED', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r28p1', 0, NULL, v_evidence),
    (v_attempt_final, v_application_final, v_order_final, v_merchant, 'R28P1-ATTEMPT-FINAL', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r28p1', 0, NULL, v_evidence);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_qty, v_item_qty, 1, 1, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_qty, v_item_qty, 1, 2, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_mixed, v_item_mixed_qty, 1, 1, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_mixed, v_item_mixed_qty, 1, 2, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_mixed, v_item_mixed_ser, 2, 1, 0, v_product_ser, v_variant_ser, 75000, 0, 'exclusive'),
    (v_application_final, v_item_final, 1, 1, 0, v_product_qty, NULL, 75000, 0, 'exclusive'),
    (v_application_final, v_item_final, 1, 2, 0, v_product_qty, NULL, 75000, 0, 'exclusive');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES
    (v_refund_qty, v_attempt_qty, 'R28P1-QTY', 75000, 'processed', 'merchandise_units'),
    (v_refund_mixed, v_attempt_mixed, 'R28P1-MIXED', 150000, 'processed', 'merchandise_units'),
    (v_refund_final, v_attempt_final, 'R28P1-FINAL', 75000, 'processing', 'merchandise_units');
  INSERT INTO private.uba_redvault_refund_line_allocations
    (refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
  VALUES
    (v_refund_qty, v_application_qty, v_item_qty, 1, 75000),
    (v_refund_mixed, v_application_mixed, v_item_mixed_qty, 1, 75000),
    (v_refund_mixed, v_application_mixed, v_item_mixed_ser, 1, 75000),
    (v_refund_final, v_application_final, v_item_final, 1, 75000);
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES
    (v_refund_qty, v_order_qty, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_mixed, v_order_mixed, 'refunded', 'review_required', 'inventory_release_requires_review', NULL);
  INSERT INTO public.variant_inventory
    (id, merchant_id, variant_id, order_id, order_item_id, branch_id, status,
     identifier_type, identifier_value, reserved_at)
  VALUES (v_unit, v_merchant, v_variant_ser, v_order_mixed, v_item_mixed_ser, NULL, 'reserved',
    'serial', 'R28P1-UNIT-1', pg_catalog.now() - interval '1 hour');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (proof without disclosure): the boolean RPC verifies the token
  -- while the snapshot row carries no token key at all.
  SELECT public.verify_order_tracking_token(v_order_qty, 'track-r28-qty') INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'valid token did not verify'; END IF;
  SELECT public.verify_order_tracking_token(v_order_qty, 'wrong-token') INTO v_ok;
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'wrong token verified'; END IF;
  SELECT public.verify_order_tracking_token(v_order_qty, '  ') INTO v_ok;
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'blank token verified'; END IF;
  SELECT to_jsonb(s) INTO v_snapshot
  FROM public.get_order_payment_snapshot(v_order_qty, 'redvault-guest-p28@example.com') AS s;
  IF v_snapshot ? 'tracking_token' THEN
    RAISE EXCEPTION 'snapshot still discloses the token: %', v_snapshot;
  END IF;
  IF (v_snapshot->>'total')::numeric <> 1500.00 THEN
    RAISE EXCEPTION 'snapshot row broken: %', v_snapshot;
  END IF;

  -- P1 (cancel restock): REDVAULT cancellation restores quantity stock
  -- on both the customer and guest paths, idempotently.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', v_user::text, 'email', 'redvault-owner-p28@example.com')::text, true);
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cancel, 'changed mind') INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'customer cancel failed'; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'customer cancel did not restock, got %', v_stock; END IF;
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cancel, 'again') INTO v_ok;
  IF v_ok IS NOT FALSE THEN RAISE EXCEPTION 'customer cancel was not idempotent'; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'idempotent cancel restocked twice, got %', v_stock; END IF;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SELECT public.cancel_storefront_order_as_guest(v_order_guest, 'track-r28-guest', 'changed mind') INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'guest cancel failed'; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 14 THEN RAISE EXCEPTION 'guest cancel did not restock, got %', v_stock; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (quantity resolution): a quantity-only partial review releases
  -- with restocked stock and a surviving shippable count of 1 of 2.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_qty) INTO v_receipt;
  IF (v_receipt->>'success')::boolean IS DISTINCT FROM true
    OR v_receipt->>'releasePath' <> 'quantity_units' THEN
    RAISE EXCEPTION 'quantity review did not resolve, got %', v_receipt;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 15 THEN RAISE EXCEPTION 'quantity review did not restock, got %', v_stock; END IF;
  SELECT (fulfillment_data->>'fulfillmentQuantity')::integer INTO v_qty
  FROM public.order_items WHERE id = v_item_qty;
  IF v_qty <> 1 THEN RAISE EXCEPTION 'surviving count wrong, got %', v_qty; END IF;

  -- P1 (mixed resolution): serialized units release and quantity stock
  -- restocks in one resolution.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_mixed) INTO v_receipt;
  IF (v_receipt->>'success')::boolean IS DISTINCT FROM true
    OR v_receipt->>'releasePath' <> 'mixed_units' THEN
    RAISE EXCEPTION 'mixed review did not resolve, got %', v_receipt;
  END IF;
  SELECT status INTO v_state FROM public.variant_inventory WHERE id = v_unit;
  IF v_state <> 'available' THEN RAISE EXCEPTION 'mixed unit not released, got %', v_state; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 16 THEN RAISE EXCEPTION 'mixed review did not restock, got %', v_stock; END IF;
  SELECT (fulfillment_data->>'fulfillmentQuantity')::integer INTO v_qty
  FROM public.order_items WHERE id = v_item_mixed_qty;
  IF v_qty <> 1 THEN RAISE EXCEPTION 'mixed surviving count wrong, got %', v_qty; END IF;

  -- P1 (finalization dispatch): a processing partial that flips to
  -- processed auto-resolves its quantity line through the trigger.
  CREATE TRIGGER finalize_redvault_processed_refund
    AFTER INSERT OR UPDATE OF state ON private.uba_redvault_refunds
    FOR EACH ROW EXECUTE FUNCTION private.finalize_redvault_processed_refund();
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_final;
  DROP TRIGGER finalize_redvault_processed_refund ON private.uba_redvault_refunds;
  SELECT inventory_state INTO v_state FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = v_refund_final;
  IF v_state <> 'released' THEN
    RAISE EXCEPTION 'finalization did not auto-resolve, got %', v_state;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_qty;
  IF v_stock <> 17 THEN RAISE EXCEPTION 'finalization did not restock, got %', v_stock; END IF;
  SELECT (fulfillment_data->>'fulfillmentQuantity')::integer INTO v_qty
  FROM public.order_items WHERE id = v_item_final;
  IF v_qty <> 1 THEN RAISE EXCEPTION 'final surviving count wrong, got %', v_qty; END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
