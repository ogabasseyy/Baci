-- A reference-based handoff must accept either UUID letter case.
DO $$
DECLARE
 m uuid:='11111111-1111-4111-8111-111111111111';
 p uuid:='44444444-4444-4444-8444-444444444444';
 offer uuid:='abcdefab-cdef-4abc-8def-abcdefabcdef';
 source uuid:='aaaaaaaa-4331-4000-8000-000000000001';
 dest uuid:='aaaaaaaa-4331-4000-8000-000000000002';
 sg uuid:='bbbbbbbb-4331-4000-8000-000000000001';
 dg uuid:='bbbbbbbb-4331-4000-8000-000000000002';
 h uuid:='cccccccc-4331-4000-8000-000000000001';
 source_line uuid:='dddddddd-4331-4000-8000-000000000001';
 result jsonb;
BEGIN
 UPDATE public.merchants SET premium_features='["shared_cart"]' WHERE id=m;
 INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
 VALUES(offer,p,m,'used',15,5,'active');
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
 (source,m,now()+interval '1 day'),(dest,m,now()+interval '1 day');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
 (sg,m,source,'case-source',now()+interval '1 day'),(dg,m,dest,'case-receiver',now()+interval '1 day');
 INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,offer_id,quantity,last_unit_price_minor)
 VALUES(source_line,m,source,p,offer,1,1500);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
   'cart_scope','session','cart_merchant_id',m,'cart_principal_id','case-source','cart_id',source,'cart_grant_id',sg)::text,true);
 result:=public.commerce_cart_issue_handoff('offer-case',h,source,'offer-case-issue','{"type":"native"}');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'handoff issue failed: %',result; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
   'cart_scope','session','cart_merchant_id',m,'cart_principal_id','case-receiver','cart_id',dest,'cart_grant_id',dg)::text,true);
 result:=public.commerce_cart_redeem_handoff('offer-case',h,'offer-case-redeem','merge','native',dest,1,1,
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',upper(offer::text)),
     'quantity',1,'sourceLineId',source_line)), '[]');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'uppercase exact offer handoff rejected: %',result;
 END IF;
END $$;
-- Unrelated exact offer B must not split negotiation lanes for offer A.
DO $$
DECLARE
 m uuid:='11111111-1111-4111-8111-111111111111';
 p uuid:='44444444-4444-4444-8444-444444444444';
 a uuid:='abcdefab-cdef-4abc-8def-abcdefabcdef';
 b uuid:='bbbbbbbb-cdef-4abc-8def-abcdefabcdef';
 source uuid:='aaaaaaaa-4332-4000-8000-000000000001'; dest uuid:='aaaaaaaa-4332-4000-8000-000000000002';
 sg uuid:='bbbbbbbb-4332-4000-8000-000000000001'; dg uuid:='bbbbbbbb-4332-4000-8000-000000000002';
 h uuid:='cccccccc-4332-4000-8000-000000000001';
 incoming_id uuid:='dddddddd-4332-4000-8000-000000000001';
 existing_id uuid:='dddddddd-4332-4000-8000-000000000002';
 other_id uuid:='dddddddd-4332-4000-8000-000000000003';
 r jsonb;
BEGIN
 INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
 VALUES(b,p,m,'open_box',15,5,'active');
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
 (source,m,now()+interval '1 day'),(dest,m,now()+interval '1 day');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
 (sg,m,source,'lanes-source',now()+interval '1 day'),(dg,m,dest,'lanes-receiver',now()+interval '1 day');
 INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,offer_id,quantity,last_unit_price_minor,negotiated_unit_price_minor,negotiation_status)
 VALUES(incoming_id,m,source,p,a,2,1500,1400,'accepted'),
 (existing_id,m,dest,p,a,5,1500,1450,'accepted'),
 (other_id,m,dest,p,b,1,1500,NULL,NULL);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
   'cart_scope','session','cart_merchant_id',m,'cart_principal_id','lanes-source','cart_id',source,'cart_grant_id',sg)::text,true);
 r:=public.commerce_cart_issue_handoff('offer-lanes',h,source,'offer-lanes-issue','{"type":"native"}');
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'offer lanes issue failed: %',r; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,
   'cart_scope','session','cart_merchant_id',m,'cart_principal_id','lanes-receiver','cart_id',dest,'cart_grant_id',dg)::text,true);
 r:=public.commerce_cart_redeem_handoff('offer-lanes',h,'offer-lanes-unresolved','merge','native',dest,1,1,
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',upper(a::text)),'quantity',2,'sourceLineId',incoming_id),
     jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',b),'quantity',1,'sourceLineId',other_id)), '[]'::jsonb);
 IF r->>'code' IS DISTINCT FROM 'merge_conflict' THEN
   RAISE EXCEPTION 'unrelated offer suppressed negotiation conflict: %',r;
 END IF;
 r:=public.commerce_cart_redeem_handoff('offer-lanes',h,'offer-lanes-redeem','merge','native',dest,1,1,
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',upper(a::text)),'quantity',2,'sourceLineId',incoming_id),
     jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',b),'quantity',1,'sourceLineId',other_id)),
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p,'offerId',upper(a::text)),'keep','incoming')));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'offer lanes merge failed: %',r; END IF;
 IF (SELECT count(*) FROM public.commerce_cart_lines WHERE cart_id=source AND offer_id=a) <> 1
    OR NOT EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=source AND offer_id=a AND quantity=2 AND negotiated_unit_price_minor=1400) THEN
   RAISE EXCEPTION 'unrelated offer prevented conflict resolution';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id=source AND offer_id=b AND quantity=1) THEN
   RAISE EXCEPTION 'handoff dropped unrelated exact offer';
 END IF;
END $$;
