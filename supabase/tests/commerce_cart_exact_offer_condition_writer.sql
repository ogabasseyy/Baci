-- Exact offer conditions must not use the parent-only condition guard.
DO $$
DECLARE
 merchant uuid := '11111111-1111-4111-8111-111111111111';
 product uuid := '44444444-4444-4444-8444-444444444499';
 offer uuid := '55555555-5555-4555-8555-555555555599';
 cart uuid := 'aaaaaaaa-2512-4000-8000-000000000099';
 grant_id uuid := 'bbbbbbbb-2512-4000-8000-000000000099';
 result jsonb;
 line uuid;
BEGIN
 INSERT INTO public.products(id,merchant_id,name,slug,price,status,stock_quantity,stock,manage_stock)
 VALUES (product,merchant,'Exact condition product','exact-condition-product',15,'active',10,10,true);
 INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
 VALUES (offer,product,merchant,'refurbished',20,4,'active');
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES (cart,merchant,now()+interval '1 day');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
 VALUES (grant_id,merchant,cart,'offer-condition',now()+interval '1 day');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id',merchant,'cart_principal_id','offer-condition','cart_id',cart,'cart_grant_id',grant_id)::text,true);
 result := public.commerce_cart_mutate(cart,'add-refurbished',1,jsonb_build_object('type','add','item',jsonb_build_object('productId',product,'offerId',offer,'condition','open_box'),'quantity',1));
 IF result->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=cart AND offer_id=offer) THEN
  RAISE EXCEPTION 'canonical exact offer condition rejected: %',result;
 END IF;
 SELECT id INTO line FROM public.commerce_cart_lines WHERE cart_id=cart AND offer_id=offer;
 result := public.commerce_cart_mutate(cart,'increase-exact',2,jsonb_build_object('type','set_quantity','lineId',line,'quantity',2));
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'exact offer quantity increase rejected: %',result; END IF;
 result := public.commerce_cart_mutate(cart,'wrong-condition',3,jsonb_build_object('type','add','item',jsonb_build_object('productId',product,'offerId',offer,'condition','used'),'quantity',1));
 IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'mismatched exact condition accepted: %',result; END IF;
 result := public.commerce_cart_mutate(cart,'missing-offer',3,jsonb_build_object('type','add','item',jsonb_build_object('productId',product,'condition','open_box'),'quantity',1));
 IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'condition-only line bypassed parent guard: %',result; END IF;
 UPDATE public.product_offers SET status='inactive' WHERE id=offer;
 result := public.commerce_cart_mutate(cart,'increase-stale',3,jsonb_build_object('type','set_quantity','lineId',line,'quantity',3));
 IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'stale offer quantity increase accepted: %',result; END IF;
END $$;
