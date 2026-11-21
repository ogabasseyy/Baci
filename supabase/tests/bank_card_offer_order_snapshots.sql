BEGIN;

DO $$
DECLARE
  v_merchant uuid := 'a4387000-0000-4000-8000-000000000001';
  v_product uuid := 'a4387000-0000-4000-8000-000000000002';
  v_bank text;
  v_order uuid;
  v_item uuid;
  v_attempt uuid;
  v_quote jsonb;
  v_context record;
BEGIN
  IF has_function_privilege('authenticated', 'private.record_bank_card_offer_order(uuid,uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.read_bank_card_offer_payment_context(uuid,uuid,uuid)', 'EXECUTE')
    OR has_table_privilege('anon', 'private.bank_card_offer_order_snapshots', 'SELECT')
  THEN
    RAISE EXCEPTION 'Bank offer snapshots must be private';
  END IF;

  IF has_function_privilege('anon', 'public.create_storefront_bank_card_offer_order(jsonb,jsonb,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_storefront_bank_card_offer_order(jsonb,jsonb,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Atomic bank-offer checkout must be available only through the authenticated route';
  END IF;
  BEGIN
    PERFORM public.create_storefront_bank_card_offer_order(
      jsonb_build_object('merchant_id', v_merchant), '{}'::jsonb, '{}'::jsonb
    );
    RAISE EXCEPTION 'Expected an unsigned bank-offer checkout to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_checkout_not_authorized' THEN RAISE; END IF;
  END;

  -- These direct fixture writes use the service actor required by the
  -- merchant audit and order-route triggers in the full replay schema.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.merchants (id, email, business_name, slug)
    VALUES (v_merchant, 'bank-offer-fixture@example.test', 'Bank Offer Fixture', 'bank-offer-fixture');
  BEGIN
    INSERT INTO public.orders (merchant_id, order_number, currency, payment_method,
      payment_status, customer_email, total, discount_amount, tax_basis)
    VALUES (v_merchant, 'BANK-OFFER-NO-PAYSTACK', 'NGN', 'bank_card_offer',
      'unpaid', 'buyer@example.test', 190, 10, 'exclusive');
    RAISE EXCEPTION 'Bank offer order without a Paystack subaccount was created';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_paystack_unavailable' THEN RAISE; END IF;
  END;
  UPDATE public.merchants SET paystack_subaccount_code = 'ACCT_fixture'
    WHERE id = v_merchant;
  INSERT INTO public.merchant_feature_settings (merchant_id, paystack_enabled)
    VALUES (v_merchant, false)
    ON CONFLICT (merchant_id) DO UPDATE SET paystack_enabled = false;
  BEGIN
    INSERT INTO public.orders (merchant_id, order_number, currency, payment_method,
      payment_status, customer_email, total, discount_amount, tax_basis)
    VALUES (v_merchant, 'BANK-OFFER-PAYSTACK-DISABLED', 'NGN', 'bank_card_offer',
      'unpaid', 'buyer@example.test', 190, 10, 'exclusive');
    RAISE EXCEPTION 'Bank offer order with Paystack disabled was created';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_paystack_unavailable' THEN RAISE; END IF;
  END;
  UPDATE public.merchant_feature_settings SET paystack_enabled = true
    WHERE merchant_id = v_merchant;
  INSERT INTO public.products (id, merchant_id, name, slug, price, status)
    VALUES (v_product, v_merchant, 'Fixture Phone', 'fixture-bank-offer-phone', 100, 'active');

  FOREACH v_bank IN ARRAY ARRAY['035', '232']
  LOOP
    v_order := gen_random_uuid();
    v_item := gen_random_uuid();
    v_attempt := gen_random_uuid();
    INSERT INTO public.orders (id, merchant_id, order_number, currency, payment_method,
      payment_status, customer_email, total, discount_amount, tax_basis)
    VALUES (v_order, v_merchant, 'BANK-OFFER-' || v_bank, 'NGN', 'bank_card_offer',
      'unpaid', 'BUYER@example.test', 190, 10, 'exclusive');
    INSERT INTO public.order_items (id, order_id, product_id, name, price, quantity)
      VALUES (v_item, v_order, v_product, 'Fixture Phone', 100, 2);
    v_quote := jsonb_build_object(
      'merchantId', v_merchant, 'discountKobo', 1000,
      'paymentPolicy', jsonb_build_object('bankCode', v_bank),
      'allocations', jsonb_build_array(jsonb_build_object(
        'itemId', v_item, 'productId', v_product, 'unitPriceKobo', 10000,
        'quantity', 2, 'unitNetAmountsKobo', jsonb_build_array(9500, 9500)
      ))
    );
    BEGIN
      PERFORM private.record_bank_card_offer_order(v_order, v_merchant,
        jsonb_set(v_quote, '{allocations,0,itemId}', '"1"'));
      RAISE EXCEPTION 'The order snapshot accepted a temporary checkout ordinal';
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
    BEGIN
      PERFORM private.record_bank_card_offer_order(v_order, v_merchant,
        jsonb_set(v_quote, '{allocations,0,productId}', '""'));
      RAISE EXCEPTION 'The order snapshot accepted an empty product ID';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_allocation_mismatch' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM private.record_bank_card_offer_order(v_order, v_merchant,
        jsonb_set(v_quote, '{allocations,0,unitNetAmountsKobo,0}', '9400'));
      RAISE EXCEPTION 'Expected invalid refund allocation to fail';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_allocation_mismatch' THEN RAISE; END IF;
    END;

    BEGIN
      UPDATE public.orders SET total = 191 WHERE id = v_order;
      PERFORM private.record_bank_card_offer_order(v_order, v_merchant, v_quote);
      RAISE EXCEPTION 'Expected the inconsistent order total to fail';
    EXCEPTION WHEN raise_exception THEN
    -- Migration 20261119153526 raises this from the snapshot insert trigger.
    IF SQLERRM <> 'bank_card_offer_order_total_mismatch' THEN RAISE; END IF;
    END;

    -- Item edits recalculate tax and totals. Establish the final fixture
    -- economics after that trigger has run.
    UPDATE public.order_items SET assurance_fee = 1 WHERE id = v_item;
    UPDATE public.orders
      SET shipping_fee = 2, gift_wrapping_fee = 3, tax_amount = 4, tax_basis = 'exclusive',
          total = 200
      WHERE id = v_order;

    PERFORM private.record_bank_card_offer_order(v_order, v_merchant, v_quote);
    PERFORM private.record_bank_card_offer_order(v_order, v_merchant, v_quote);
    BEGIN
      PERFORM private.record_bank_card_offer_order(v_order, v_merchant,
        jsonb_set(v_quote, '{paymentPolicy,bankCode}',
          to_jsonb(CASE WHEN v_bank = '035' THEN '232'::text ELSE '035'::text END)));
      RAISE EXCEPTION 'Expected an attempt to replace bank identity to fail';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_snapshot_conflict' THEN RAISE; END IF;
    END;
    INSERT INTO public.transactions (id, merchant_id, order_id, transaction_type,
      amount, currency, gateway, gateway_reference)
      VALUES (v_attempt, v_merchant, v_order, 'payment',
        200, 'NGN', 'paystack', 'BANK-OFFER-TEST-' || v_bank);

    SELECT quote, amount_kobo, customer_email, reference INTO STRICT v_context
      FROM private.read_bank_card_offer_payment_context(v_order, v_merchant, v_attempt);
    IF v_context.quote IS DISTINCT FROM v_quote
      OR v_context.amount_kobo <> 20000
      OR v_context.customer_email <> 'buyer@example.test'
      OR v_context.reference <> 'BANK-OFFER-TEST-' || v_bank
      OR v_context.quote #>> '{allocations,0,unitNetAmountsKobo,1}' <> '9500'
    THEN
      RAISE EXCEPTION 'Order snapshot changed bank, amount, or unit allocation';
    END IF;
    IF EXISTS (SELECT 1 FROM private.read_bank_card_offer_payment_context(
      v_order, gen_random_uuid(), v_attempt
    )) THEN
      RAISE EXCEPTION 'Verification context leaked to another merchant';
    END IF;
    BEGIN
      UPDATE public.orders SET total = 201 WHERE id = v_order;
      RAISE EXCEPTION 'Bank-offer order total was mutable';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_order_snapshot_immutable' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.order_items SET product_id = gen_random_uuid() WHERE id = v_item;
      RAISE EXCEPTION 'Bank-offer order item was mutable';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_order_snapshot_immutable' THEN RAISE; END IF;
    END;
    UPDATE public.transactions SET amount = 201 WHERE id = v_attempt;
    IF EXISTS (SELECT 1 FROM private.read_bank_card_offer_payment_context(
      v_order, v_merchant, v_attempt
    )) THEN
      RAISE EXCEPTION 'Verification accepted an amount outside the order snapshot';
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;
