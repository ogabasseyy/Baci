-- Actual cart authority, with schema-valid offer conditions (no mixed-case rows).
CREATE TEMP TABLE exact_offer_review_failures(message text);
CREATE FUNCTION pg_temp.check_offer_review(ok boolean, message text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO exact_offer_review_failures SELECT message WHERE NOT coalesce(ok, false) $$;
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '44444444-4444-4444-8444-444444444445';
  offer uuid := '55555555-5555-4555-8555-555555555556';
  cart uuid := 'aaaaaaaa-2513-4000-8000-000000000001';
  grant_id uuid := 'bbbbbbbb-2513-4000-8000-000000000001';
  command jsonb;
  result jsonb;
  snapshot jsonb;
  invalid_attachment jsonb;
  version integer;
BEGIN
  INSERT INTO public.products(id,merchant_id,price,status,stock_quantity,stock,manage_stock)
  VALUES(product,merchant,50,'active',20,20,true);
  INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
  VALUES(offer,product,merchant,'used',40,4,'active');
  INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(cart,merchant,now()+interval '1 day');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
  VALUES(grant_id,merchant,cart,'offer-review',now()+interval '1 day');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
    'cart_scope','session','cart_merchant_id',merchant,'cart_principal_id','offer-review',
    'cart_id',cart,'cart_grant_id',grant_id)::text,true);
  command := jsonb_build_object('type','add','item',jsonb_build_object('productId',product,'offerId',offer),'quantity',1);
  -- Every writer reaches this parser, including add, replace, create and import.
  FOREACH invalid_attachment IN ARRAY ARRAY[
    '{"item":{"variantId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}}'::jsonb,
    '{"voucherToken":"fixture-voucher","voucherAwardId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.commerce_cart_parse_offer_id(
        (command || invalid_attachment) || jsonb_build_object('item',
          (command->'item') || coalesce(invalid_attachment->'item','{}'::jsonb)));
      PERFORM pg_temp.check_offer_review(false,'parser accepted incompatible exact-offer attachments');
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'invalid_line' THEN RAISE; END IF;
    END;
  END LOOP;
  result := public.commerce_cart_mutate(cart,'review-add',1,command);
  PERFORM pg_temp.check_offer_review(result->>'ok'='true','valid ID-only exact offer failed');
  snapshot := public.commerce_cart_build_checkout_snapshot(merchant,cart);
  PERFORM pg_temp.check_offer_review(snapshot->'lines'->0->>'condition'='used',
    'ID-only review did not resolve the exact offer condition');
  PERFORM pg_temp.check_offer_review((snapshot->'lines'->0->>'available')::boolean,
    'live exact offer was unavailable');
  UPDATE public.product_offers SET status='inactive' WHERE id=offer;
  snapshot := public.commerce_cart_build_checkout_snapshot(merchant,cart);
  PERFORM pg_temp.check_offer_review(NOT (snapshot->'lines'->0->>'available')::boolean,
    'inactive exact offer fell back to available parent stock');
  DELETE FROM public.product_offers WHERE id=offer;
  snapshot := public.commerce_cart_build_checkout_snapshot(merchant,cart);
  PERFORM pg_temp.check_offer_review(NOT (snapshot->'lines'->0->>'available')::boolean,
    'deleted exact offer fell back to available parent stock');
  -- A parent-only line stays valid: the exact-offer guard must not invent an ID.
  PERFORM pg_temp.check_offer_review(public.commerce_cart_parse_offer_id(
    jsonb_build_object('item',jsonb_build_object('productId',product))) IS NULL,
    'parent-only parser contract changed');
END $$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM exact_offer_review_failures) THEN
    RAISE EXCEPTION 'exact offer review failed: %',
      (SELECT string_agg(message,'; ') FROM exact_offer_review_failures);
  END IF;
END $$;
