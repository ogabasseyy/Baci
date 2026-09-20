-- Round-11 P1 regressions: the worker cleanup transition serializes on the
-- order payment lock; capture refuses cancelled orders; customers cancel
-- REDVAULT orders through a dedicated protected RPC that releases the fence.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-000000000071';
  v_customer uuid := '22222222-0000-4000-8000-000000000071';
  v_order_lock uuid := '10000000-0000-4000-8000-000000000071';
  v_order_cap_cancelled uuid := '10000000-0000-4000-8000-000000000072';
  v_order_cap_unpaid uuid := '10000000-0000-4000-8000-000000000073';
  v_order_cust uuid := '10000000-0000-4000-8000-000000000074';
  v_order_cust_held uuid := '10000000-0000-4000-8000-000000000075';
  v_order_cust_refund uuid := '10000000-0000-4000-8000-000000000076';
  v_order_cust_paid uuid := '10000000-0000-4000-8000-000000000077';
  v_order_cust_plain uuid := '10000000-0000-4000-8000-000000000078';
  v_application_capc uuid := 'd1000000-0000-4000-8000-000000000072';
  v_attempt_capc uuid := 'd2000000-0000-4000-8000-000000000072';
  v_application_cust uuid := 'd1000000-0000-4000-8000-000000000074';
  v_application_held uuid := 'd1000000-0000-4000-8000-000000000075';
  v_application_refund uuid := 'd1000000-0000-4000-8000-000000000076';
  v_attempt_cust uuid := 'd2000000-0000-4000-8000-000000000074';
  v_attempt_held uuid := 'd2000000-0000-4000-8000-000000000075';
  v_attempt_refund uuid := 'd2000000-0000-4000-8000-000000000076';
  v_refund_live uuid := 'e1000000-0000-4000-8000-000000000076';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000071';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000071';
  v_product uuid := 'b0000000-0000-4000-8000-000000000071';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000071';
  v_item_cust uuid := '20000000-0000-4000-8000-000000000074';
  v_unit_cust uuid := 'a0000000-0000-4000-8000-000000000074';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_state text;
  v_status text;
  v_cancelled boolean;
  v_locks_before bigint;
  v_locks_after bigint;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p11@example.com', 'Redvault P11')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R11P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P11 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p11@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status, created_at)
  VALUES
    (v_order_lock, v_merchant, v_customer, 'R11P1-LOCK', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '100 hours'),
    (v_order_cap_cancelled, v_merchant, v_customer, 'R11P1-CAPC', 1500.00, 'uba_redvault', 'cancelled', 'cancelled',
     pg_catalog.now() - interval '100 hours'),
    (v_order_cap_unpaid, v_merchant, v_customer, 'R11P1-CAPU', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '100 hours'),
    (v_order_cust, v_merchant, v_customer, 'R11P1-CUST', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cust_held, v_merchant, v_customer, 'R11P1-HELD', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cust_refund, v_merchant, v_customer, 'R11P1-REF', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cust_paid, v_merchant, v_customer, 'R11P1-PAID', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_cust_plain, v_merchant, v_customer, 'R11P1-PLAIN', 1500.00, 'card', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_cust, v_order_cust, v_product, v_variant, 'Redvault P11 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES (v_unit_cust, v_merchant, v_order_cust, v_item_cust, v_variant, 'reserved', 'serial', 'R11P1-001');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_capc, v_order_cap_cancelled, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p11@example.com', 'R11P1-CAPC', 'R11P1-CAPC', 100, 150000, 'pending'),
    (v_application_cust, v_order_cust, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p11@example.com', 'R11P1-CUST', 'R11P1-CUST', 100, 150000, 'pending'),
    (v_application_held, v_order_cust_held, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p11@example.com', 'R11P1-HELD', 'R11P1-HELD', 100, 150000, 'pending'),
    (v_application_refund, v_order_cust_refund, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p11@example.com', 'R11P1-REF', 'R11P1-REF', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state)
  VALUES
    (v_attempt_capc, v_application_capc, v_order_cap_cancelled, v_merchant, 'R11P1-CAPC', v_hash,
     150000, 'NGN', 'initialized'),
    (v_attempt_cust, v_application_cust, v_order_cust, v_merchant, 'R11P1-ATTEMPT-CUST', v_hash,
     150000, 'NGN', 'initialized'),
    (v_attempt_held, v_application_held, v_order_cust_held, v_merchant, 'R11P1-ATTEMPT-HELD', v_hash,
     150000, 'NGN', 'captured_held'),
    (v_attempt_refund, v_application_refund, v_order_cust_refund, v_merchant, 'R11P1-ATTEMPT-REF', v_hash,
     150000, 'NGN', 'created');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES (v_refund_live, v_attempt_refund, 'needs_reconciliation', 'merchandise_units', 'R11P1-LIVE', 10000);
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    ('d3000000-0000-4000-8000-000000000072', v_merchant, v_order_cap_cancelled, 'payment', 1500.00, 'NGN',
     'completed', 'paystack', 'R11P1-CAPC', NULL),
    ('d3000000-0000-4000-8000-000000000073', v_merchant, v_order_cap_unpaid, 'payment', 1500.00, 'NGN',
     'completed', 'paystack', 'R11P1-CAPU', NULL);

  -- P1 (serialization): the worker cleanup transition takes the order
  -- payment lock before reading attempt state, so an in-flight capture
  -- commits first instead of landing on a cancelled row.
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  SELECT count(*) INTO v_locks_before FROM pg_catalog.pg_locks
  WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory';
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE id = v_order_lock AND payment_status = 'unpaid';
  SELECT count(*) INTO v_locks_after FROM pg_catalog.pg_locks
  WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory';
  IF v_locks_after <= v_locks_before THEN
    RAISE EXCEPTION 'cleanup did not take the order payment lock';
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_lock;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'plain stale draft was not cancelled, got %', v_state;
  END IF;

  -- P1 (serialization, capture side): a capture racing a lost cleanup
  -- refuses the cancelled order instead of recording held funds on it.
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(
      'd3000000-0000-4000-8000-000000000072', v_order_cap_cancelled, 'paystack', 'R11P1-CAPC',
      '{"reference":"R11P1-CAPC","amount":"150000","currency":"NGN","status":"success"}'::jsonb);
    RAISE EXCEPTION 'capture on a cancelled order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_capture_order_cancelled' THEN RAISE; END IF;
  END;
  -- The guard is placement-tight: an unpaid order with no attempt still
  -- reaches the attempt lookup instead of tripping the cancelled check.
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(
      'd3000000-0000-4000-8000-000000000073', v_order_cap_unpaid, 'paystack', 'R11P1-CAPU',
      '{"reference":"R11P1-CAPU","amount":"150000","currency":"NGN","status":"success"}'::jsonb);
    RAISE EXCEPTION 'capture without an attempt unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_capture_attempt_not_found' THEN RAISE; END IF;
  END;

  -- P1 (customer cancellation): an authenticated owner cancels a fresh
  -- unpaid REDVAULT draft through the protected path; the fence releases.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cust, 'changed my mind')
  INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN
    RAISE EXCEPTION 'customer cancel did not cancel';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_cust;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'customer cancel left payment %, want cancelled', v_state;
  END IF;
  SELECT shipping_status INTO v_status FROM public.orders WHERE id = v_order_cust;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'customer cancel left shipping %, want cancelled', v_status;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory WHERE id = v_unit_cust;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'customer cancel did not release the fence, got %', v_status;
  END IF;
  -- Idempotent: a second cancel is a no-op.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_cust, 'again')
  INTO v_cancelled;
  IF v_cancelled IS NOT FALSE THEN
    RAISE EXCEPTION 'second customer cancel was not a no-op';
  END IF;
  -- Funds in flight stay payable: held captures and live refunds reject.
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_held, 'nope');
    RAISE EXCEPTION 'customer cancel of a held capture unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_refund, 'nope');
    RAISE EXCEPTION 'customer cancel with a live refund unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  -- Paid, foreign-method, and foreign-owner orders are rejected.
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_paid, 'nope');
    RAISE EXCEPTION 'customer cancel of a paid order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_cancellable' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_plain, 'nope');
    RAISE EXCEPTION 'customer cancel of a non-REDVAULT order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_cancellable' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_paid, 'nope');
    RAISE EXCEPTION 'customer cancel by a non-owner unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  -- Service-role callers are refused: this is the customer path.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_cust_paid, 'nope');
    RAISE EXCEPTION 'service-role customer cancel unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden: cancel_uba_redvault_order_as_customer requires authenticated' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
