-- Actual final cart/preparation/binding functions, disposable catalog/orders only.
CREATE TEMP TABLE checkout_add_failures(message text);
CREATE FUNCTION pg_temp.check_checkout_add(ok boolean,message text) RETURNS void LANGUAGE sql AS $$ INSERT INTO checkout_add_failures SELECT message WHERE NOT coalesce(ok,false) $$;
UPDATE public.merchants SET premium_features='["shared_cart"]' WHERE id='11111111-1111-4111-8111-111111111111';
CREATE FUNCTION pg_temp.checkout_add_claim(c uuid,g uuid,principal text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id',principal,'cart_id',c,'cart_grant_id',g)::text,true) $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 c uuid:='aaaaaaaa-4400-4000-8000-000000000001'; g uuid:='bbbbbbbb-4400-4000-8000-000000000001'; r jsonb; cmd jsonb;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES(g,m,c,'add-lanes',now()+interval '1 day');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor) VALUES(m,c,p,1,1500);
 PERFORM pg_temp.checkout_add_claim(c,g,'add-lanes');
 cmd:=jsonb_build_object('type','add','item',jsonb_build_object('productId',p),'quantity',2,'negotiatedUnitPriceMinor',1470,'negotiationStatus','accepted');
 r:=public.commerce_cart_mutate(c,'add-negotiated',1,cmd);
 PERFORM pg_temp.check_checkout_add(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor=1470 AND negotiation_status='accepted' AND quantity=2) AND EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor IS NULL AND quantity=1),'add silently incremented ordinary lane or lost negotiation');
 r:=public.commerce_cart_mutate(c,'add-normalized',2,cmd||'{"quantity":1,"negotiationStatus":"pending"}');
 -- Pending remains a separate legal context; accepted input on a deep offer
 -- normalizes to pending before lookup and aggregates only the normalized lane.
 PERFORM pg_temp.check_checkout_add(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor=1470 AND negotiation_status='pending' AND quantity=1),'add pending context collapsed into accepted sibling');
 cmd:=cmd||'{"negotiatedUnitPriceMinor":1000,"quantity":2}';
 r:=public.commerce_cart_mutate(c,'add-deep',3,cmd);
 r:=public.commerce_cart_mutate(c,'add-deep-again',4,cmd||'{"quantity":1}');
 PERFORM pg_temp.check_checkout_add(r->>'ok'='true' AND (SELECT count(*)=1 AND min(quantity)=3 AND bool_and(negotiation_status='pending') FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor=1000),'add failed normalized deep-offer duplicate or trusted accepted input');
 r:=public.commerce_cart_mutate(c,'add-deep-again',4,cmd||'{"quantity":1}');
 PERFORM pg_temp.check_checkout_add(r->>'replayed'='true' AND (SELECT sum(quantity)=3 FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor=1000),'add replay incremented normalized negotiation');
 r:=public.commerce_cart_mutate(c,'add-ordinary-again',5,jsonb_build_object('type','add','item',jsonb_build_object('productId',p),'quantity',1));
 PERFORM pg_temp.check_checkout_add(r->>'ok'='true' AND (SELECT count(*)=1 AND min(quantity)=2 FROM public.commerce_cart_lines WHERE cart_id=c AND negotiated_unit_price_minor IS NULL),'ordinary add failed beside negotiation siblings');
END $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 c uuid; g uuid; sid uuid; r jsonb; replay jsonb; args jsonb; n integer; gen integer;
BEGIN
 FOR n IN 1..4 LOOP
  c:=('aaaaaaaa-4401-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  g:=('bbbbbbbb-4401-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES(c,m,now()-interval '7 days'+interval '10 minutes',now()+interval '1 minute');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES(g,m,c,'checkout-cap-'||n,now()-interval '7 days'+interval '5 minutes',now()+interval '1 minute');
  INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor) VALUES(m,c,p,1,1500);
  PERFORM pg_temp.checkout_add_claim(c,g,'checkout-cap-'||n);
  r:=public.commerce_cart_prepare_checkout(c,1,'prepare-cap');
  PERFORM pg_temp.check_checkout_add(r->>'ok'='true','near-deadline preparation rejected');
  sid:=(r->'snapshot'->>'checkoutSessionId')::uuid; gen:=(r->'snapshot'->>'generation')::integer;
  PERFORM pg_temp.check_checkout_add((r->>'sessionExpiresAt')::timestamptz=now()+interval '5 minutes','session exceeded preparing grant absolute deadline');
  PERFORM pg_temp.check_checkout_add((SELECT expires_at<=created_at+interval '7 days' FROM public.commerce_carts WHERE id=c),'prepare extended cart beyond own lifetime');
  PERFORM pg_temp.check_checkout_add((SELECT expires_at<=created_at+interval '7 days' FROM public.commerce_cart_grants WHERE id=g),'prepare extended grant beyond own lifetime');
  replay:=public.commerce_cart_prepare_checkout(c,1,'prepare-cap');
  PERFORM pg_temp.check_checkout_add(replay->>'replayed'='true' AND replay->>'sessionExpiresAt'=r->>'sessionExpiresAt','prepare replay changed bounded session');
  args:=jsonb_build_object('p_merchant_id',m,'p_cart_id',c,'p_cart_version',1,'p_cart_principal_id','checkout-cap-'||n,
   'p_customer_email','fixture@example.invalid','p_customer_name','Fixture','p_checkout_idempotency_key','checkout-cap-order-'||n,
   'p_items',jsonb_build_array(jsonb_build_object('cart_line_id',(SELECT id FROM public.commerce_cart_lines WHERE cart_id=c),
     'product_id',p,'quantity',1,'price',15,'variant_attributes','{}'::jsonb)));
  -- Simulate legacy overlong persisted expiries; binding must enforce age
  -- independently of a successful new prepare's already-bounded expiry.
  UPDATE public.commerce_cart_checkout_sessions SET expires_at=now()+interval '1 hour' WHERE id=sid;
  UPDATE public.commerce_carts SET expires_at=now()+interval '1 hour' WHERE id=c;
  UPDATE public.commerce_cart_grants SET expires_at=now()+interval '1 hour' WHERE id=g;
  IF n=1 THEN UPDATE public.commerce_carts SET created_at=now()-interval '8 days' WHERE id=c;
  ELSIF n=2 THEN UPDATE public.commerce_cart_grants SET created_at=now()-interval '8 days' WHERE id=g;
  ELSIF n=3 THEN UPDATE public.commerce_cart_checkout_sessions SET created_at=now()-interval '8 days' WHERE id=sid;
  ELSE
   UPDATE public.commerce_cart_checkout_sessions SET created_at=now()-interval '7 days'+interval '2 minutes' WHERE id=sid;
   r:=public.commerce_cart_prepare_checkout(c,1,'prepare-reuse');
   PERFORM pg_temp.check_checkout_add((r->>'sessionExpiresAt')::timestamptz=now()+interval '2 minutes','reused session exceeded its own absolute deadline');
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',m)::text,true);
   r:=public.create_storefront_order_with_cart_binding('base',sid,gen,args);
   PERFORM pg_temp.check_checkout_add(r->>'ok'='true','live bounded checkout binding rejected');
   CONTINUE;
  END IF;
  r:=public.commerce_cart_prepare_checkout(c,1,'prepare-cap');
  PERFORM pg_temp.check_checkout_add(r->>'code'='expired','prepare replay accepted past absolute deadline '||n);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',m)::text,true);
  BEGIN
   PERFORM public.create_storefront_order_with_cart_binding('base',sid,gen,args);
   PERFORM pg_temp.check_checkout_add(false,'binding accepted past absolute deadline '||n);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN('cart_checkout_expired','cart_order_unauthorized') THEN
    PERFORM pg_temp.check_checkout_add(false,'binding reached downstream validation beyond deadline '||n||': '||SQLERRM);
   END IF;
  END;
 END LOOP;
END $$;
DO $$ DECLARE failures text; BEGIN SELECT string_agg(message,E'\n') INTO failures FROM checkout_add_failures; IF failures IS NOT NULL THEN RAISE EXCEPTION E'Checkout/add regressions:\n%',failures; END IF; END $$;
