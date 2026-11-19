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

  INSERT INTO public.merchants (id, email, business_name, slug)
    VALUES (v_merchant, 'bank-offer-fixture@example.test', 'Bank Offer Fixture', 'bank-offer-fixture');
  INSERT INTO public.products (id, merchant_id, name, slug, price, status)
    VALUES (v_product, v_merchant, 'Fixture Phone', 'fixture-bank-offer-phone', 100, 'active');

  FOREACH v_bank IN ARRAY ARRAY['035', '232']
  LOOP
    v_order := gen_random_uuid();
    v_item := gen_random_uuid();
    v_attempt := gen_random_uuid();
    INSERT INTO public.orders (id, merchant_id, order_number, currency, payment_method,
      payment_status, customer_email, total, discount_amount)
    VALUES (v_order, v_merchant, 'BANK-OFFER-' || v_bank, 'NGN', 'bank_card_offer',
      'unpaid', 'BUYER@example.test', 190, 10);
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
        jsonb_set(v_quote, '{allocations,0,unitNetAmountsKobo,0}', '9400'));
      RAISE EXCEPTION 'Expected invalid refund allocation to fail';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_allocation_mismatch' THEN RAISE; END IF;
    END;

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
        190, 'NGN', 'paystack', 'BANK-OFFER-TEST-' || v_bank);

    SELECT quote, amount_kobo, customer_email, reference INTO STRICT v_context
      FROM private.read_bank_card_offer_payment_context(v_order, v_merchant, v_attempt);
    IF v_context.quote IS DISTINCT FROM v_quote
      OR v_context.amount_kobo <> 19000
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
    UPDATE public.transactions SET amount = 200 WHERE id = v_attempt;
    IF EXISTS (SELECT 1 FROM private.read_bank_card_offer_payment_context(
      v_order, v_merchant, v_attempt
    )) THEN
      RAISE EXCEPTION 'Verification accepted an amount outside the order snapshot';
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;
