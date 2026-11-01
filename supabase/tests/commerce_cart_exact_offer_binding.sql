-- Runs against the real cart/session/binding functions with a recording order
-- RPC stub. Verifies the items handed to checkout, not provider fulfillment.
CREATE TEMP TABLE exact_offer_binding_failures(message text);
-- Recording-only REDVAULT entrypoint: exercise the current binding dispatch
-- and preserve its signed-item check without payments or provider access.
CREATE FUNCTION public.create_storefront_redvault_order(p_order jsonb,p_quote jsonb,p_proof jsonb)
RETURNS TABLE(id uuid,status text,idempotency_replayed boolean) LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.order_stub_calls(variant,merchant_id,idempotency_key,items)
  VALUES('redvault',(p_order->>'merchant_id')::uuid,p_order->>'checkout_idempotency_key',p_order->'items');
  INSERT INTO public.orders(id,merchant_id,order_number,checkout_idempotency_key,items)
  VALUES(v_id,(p_order->>'merchant_id')::uuid,'offer-redvault',p_order->>'checkout_idempotency_key',p_order->'items');
  RETURN QUERY SELECT v_id,'pending'::text,false;
END $$;
CREATE FUNCTION pg_temp.check_offer_binding(ok boolean, message text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO exact_offer_binding_failures SELECT message WHERE NOT coalesce(ok, false) $$;
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '44444444-4444-4444-8444-444444444446';
  offer_a uuid := '55555555-5555-4555-8555-555555555557';
  offer_b uuid := '66666666-6666-4666-8666-666666666667';
  cart uuid;
  line_id uuid;
  grant_id uuid;
  mode integer;
  prep jsonb;
  args jsonb;
  result jsonb;
  item jsonb;
  calls_before integer;
  calls_after integer;
  rejected boolean;
BEGIN
  -- Equal prices prevent a price mismatch from masking an identity failure.
  INSERT INTO public.products(id,merchant_id,price,status,stock_quantity,stock,manage_stock)
  VALUES(product,merchant,40,'active',20,20,true);
  INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
  VALUES(offer_a,product,merchant,'used',40,4,'active'),
    (offer_b,product,merchant,'open_box',40,4,'active');
  FOR mode IN 0..6 LOOP
    IF mode=5 THEN UPDATE public.product_offers SET condition='refurbished' WHERE id=offer_a; END IF;
    cart := ('eeeeeeee-2514-4000-8000-'||lpad(mode::text,12,'0'))::uuid;
    line_id := ('ffffffff-2514-4000-8000-'||lpad(mode::text,12,'0'))::uuid;
    grant_id := ('bbbbbbbb-2514-4000-8000-'||lpad(mode::text,12,'0'))::uuid;
    INSERT INTO public.commerce_carts(id,merchant_id,expires_at)
    VALUES(cart,merchant,now()+interval '1 day');
    INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
    VALUES(grant_id,merchant,cart,'offer-binding',now()+interval '1 day');
    INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,offer_id,
      condition,quantity,last_unit_price_minor)
    VALUES(line_id,merchant,cart,product,offer_a,
      CASE WHEN mode=2 THEN 'used' ELSE NULL END,1,4000);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
      'cart_scope','session','cart_merchant_id',merchant,'cart_principal_id','offer-binding',
      'cart_id',cart,'cart_grant_id',grant_id)::text,true);
    prep := public.commerce_cart_prepare_checkout(cart,1,'offer-binding-'||mode::text);
    PERFORM pg_temp.check_offer_binding(prep->>'ok'='true','preparation failed for mode '||mode);
    item := jsonb_build_object('cart_line_id',line_id,'product_id',product,
      'offer_id',CASE WHEN mode=2 THEN offer_b ELSE offer_a END,
      'condition',CASE WHEN mode>=5 THEN 'refurbished' ELSE 'used' END,'quantity',1,'price',40);
    args := jsonb_build_object('p_merchant_id',merchant,'p_customer_email','fixture@example.com',
      'p_customer_name','Offer fixture','p_items',jsonb_build_array(item),
      'p_expected_total',40,'p_cart_principal_id','offer-binding',
      'p_checkout_idempotency_key','offer-binding-'||mode::text,
      'p_checkout_request_hash','offer-binding-hash-'||mode::text);
    IF mode=4 THEN
      args := args || jsonb_build_object('p_payment_method','uba_redvault',
        'p_redvault_order',jsonb_build_object('merchant_id',merchant,'customer_email','fixture@example.com',
          'payment_method','uba_redvault','checkout_idempotency_key','offer-binding-'||mode::text,
          'items',jsonb_build_array(item)), 'p_redvault_quote','{}'::jsonb,'p_redvault_route_proof','{}'::jsonb);
    END IF;
    IF mode IN (1,6) THEN
      PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
        'agentic_context','checkout','agentic_merchant_id',merchant)::text,true);
    ELSE
      PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
        'storefront_order_context','route','storefront_order_merchant_id',merchant)::text,true);
    END IF;
    IF mode=3 THEN UPDATE public.product_offers SET status='inactive' WHERE id=offer_a; END IF;
    SELECT count(*) INTO calls_before FROM public.order_stub_calls;
    rejected := false;
    BEGIN
      result := public.create_storefront_order_with_cart_binding(CASE WHEN mode=4 THEN 'redvault' ELSE 'base' END,
        (prep->'snapshot'->>'checkoutSessionId')::uuid,
        (prep->'snapshot'->>'generation')::integer,args);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
      rejected := true;
    END;
    SELECT count(*) INTO calls_after FROM public.order_stub_calls;
    IF mode IN (2,3) THEN
      PERFORM pg_temp.check_offer_binding(rejected AND calls_before=calls_after,
        'substituted or stale offer reached the inner order RPC, mode '||mode);
    ELSE
      PERFORM pg_temp.check_offer_binding(NOT rejected AND result->>'ok'='true',
        'valid ID-only checkout rejected, mode '||mode);
      PERFORM pg_temp.check_offer_binding(calls_after=calls_before+1 AND EXISTS(
        SELECT 1 FROM public.order_stub_calls WHERE seq=(SELECT max(seq) FROM public.order_stub_calls)
          AND items->0->>'offer_id'=offer_a::text
          AND items->0->>'condition'=CASE WHEN mode>=5 THEN 'refurbished' ELSE 'used' END),
        'checkout lost the reviewed exact offer identity, mode '||mode);
    END IF;
    UPDATE public.product_offers SET status='active' WHERE id=offer_a;
  END LOOP;
END $$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM exact_offer_binding_failures) THEN
    RAISE EXCEPTION 'exact offer binding failed: %',
      (SELECT string_agg(message,'; ') FROM exact_offer_binding_failures);
  END IF;
END $$;
