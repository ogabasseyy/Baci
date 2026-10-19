-- Deterministic actual public handoff RPC regressions in an owned database.
UPDATE public.merchants SET premium_features='["shared_cart"]' WHERE id='11111111-1111-4111-8111-111111111111';
CREATE FUNCTION pg_temp.handoff_claim(cart uuid,grant_id uuid,principal text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id',principal,'cart_id',cart,'cart_grant_id',grant_id)::text,true)::text IS NOT NULL;
$$;
CREATE TEMP TABLE handoff_failures(message text);
CREATE FUNCTION pg_temp.handoff_check(ok boolean,message text) RETURNS void LANGUAGE sql AS $$ INSERT INTO handoff_failures SELECT message WHERE NOT coalesce(ok,false) $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 source uuid:='aaaaaaaa-3000-4000-8000-000000000001'; dest uuid:='aaaaaaaa-3000-4000-8000-000000000002';
 sg uuid:='bbbbbbbb-3000-4000-8000-000000000001'; dg uuid:='bbbbbbbb-3000-4000-8000-000000000002';
 h uuid:='cccccccc-3000-4000-8000-000000000001'; r jsonb; replay jsonb; lines jsonb;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
 (source,m,now()-interval '7 days'+interval '2 minutes',now()+interval '1 minute'),
 (dest,m,now()-interval '7 days'+interval '3 minutes',now()+interval '1 minute');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
 (sg,m,source,'attachment-source',now()-interval '7 days'+interval '90 seconds',now()+interval '1 minute'),
 (dg,m,dest,'attachment-receiver',now()-interval '7 days'+interval '100 seconds',now()+interval '1 minute');
 -- Existing receiving authority on canonical source must retain its own deadline.
 INSERT INTO public.commerce_cart_grants(merchant_id,cart_id,principal_id,created_at,expires_at)
 VALUES(m,source,'attachment-receiver',now()-interval '7 days'+interval '80 seconds',now()+interval '1 minute');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor,negotiated_unit_price_minor,negotiation_status,voucher_token,voucher_award_id) VALUES
 (m,source,p,2,1500,NULL,NULL,NULL,NULL),
 (m,source,p,1,1500,NULL,NULL,'voucher-one','dddddddd-3000-4000-8000-000000000001'),
 (m,source,p,3,1500,1470,'accepted',NULL,NULL),
 (m,dest,p,4,1500,NULL,NULL,NULL,NULL),
 (m,dest,p,1,1500,NULL,NULL,'voucher-two','dddddddd-3000-4000-8000-000000000002'),
 (m,dest,p,2,1500,1480,'accepted',NULL,NULL);
 PERFORM pg_temp.handoff_claim(source,sg,'attachment-source');
 r:=public.commerce_cart_issue_handoff('attachment-lifetime',h,source,'attachment-issue','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','near-deadline issue rejected');
 PERFORM pg_temp.handoff_check((SELECT expires_at=now()+interval '1 minute' FROM public.commerce_cart_handoffs WHERE id=h),'issued token exceeds current cart/grant expiry');
 replay:=public.commerce_cart_issue_handoff('attachment-lifetime',h,source,'attachment-issue','{"type":"native"}');
 PERFORM pg_temp.handoff_check(replay->>'replayed'='true' AND replay->'handoff'=r->'handoff','issue replay changed deadline');
 lines:=jsonb_build_array(
 jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',4),
 jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',1,'voucherToken','voucher-one','voucherAwardId','dddddddd-3000-4000-8000-000000000001'),
 jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',1,'voucherToken','voucher-two','voucherAwardId','dddddddd-3000-4000-8000-000000000002'),
 jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',3,'negotiatedUnitPriceMinor',1470,'negotiationStatus','accepted'),
 jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',2,'negotiatedUnitPriceMinor',1480,'negotiationStatus','accepted'));
 -- Model actual redacted preview -> shared planner: only item, quantity and
 -- opaque sourceLineId are submitted. No voucher or negotiation fields leave.
 SELECT jsonb_agg(jsonb_build_object('item',line->'item','quantity',line->'quantity',
   'sourceLineId',(SELECT l.id FROM public.commerce_cart_lines l WHERE l.cart_id IN(source,dest)
     AND l.product_id=p AND l.voucher_token IS NOT DISTINCT FROM line->>'voucherToken'
     AND l.voucher_award_id::text IS NOT DISTINCT FROM line->>'voucherAwardId'
     AND l.negotiated_unit_price_minor::text IS NOT DISTINCT FROM line->>'negotiatedUnitPriceMinor'
     AND l.negotiation_status IS NOT DISTINCT FROM line->>'negotiationStatus' ORDER BY (l.cart_id=source) DESC,l.id LIMIT 1)))
 INTO lines FROM jsonb_array_elements(lines) line;
 PERFORM pg_temp.handoff_claim(dest,dg,'attachment-receiver');
 r:=public.commerce_cart_redeem_handoff('attachment-lifetime',h,'attachment-omitted','merge','native',dest,1,1,lines-1,'[]');
 PERFORM pg_temp.handoff_check(r->>'code'='invalid_item','omitted redacted sibling was silently dropped');
 r:=public.commerce_cart_redeem_handoff('attachment-lifetime',h,'attachment-foreign','merge','native',dest,1,1,
   jsonb_set(lines,'{0,sourceLineId}','"ffffffff-ffff-4fff-8fff-ffffffffffff"'),'[]');
 PERFORM pg_temp.handoff_check(r->>'code'='invalid_item','foreign source line selector accepted');
 r:=public.commerce_cart_redeem_handoff('attachment-lifetime',h,'attachment-duplicate','merge','native',dest,1,1,
   lines||jsonb_build_array(lines->0),'[]');
 PERFORM pg_temp.handoff_check(r->>'code'='invalid_item','repeated same stored reference accepted');
 -- Redacted client cannot compare private contexts, so sends both source refs.
 lines:=jsonb_set(lines,'{0,quantity}','2')||jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',4,'sourceLineId',
     (SELECT id FROM public.commerce_cart_lines WHERE cart_id=dest AND voucher_token IS NULL AND negotiated_unit_price_minor IS NULL)));
 r:=public.commerce_cart_redeem_handoff('attachment-lifetime',h,'attachment-merge','merge','native',dest,1,1,lines,'[]');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','legal stored attachment siblings rejected');
 IF r->>'ok'='true' THEN
  PERFORM pg_temp.handoff_check((SELECT count(*)=5 AND sum(quantity)=11 FROM public.commerce_cart_lines WHERE cart_id=source),'attachment siblings collapsed or wrong quantity selected');
  PERFORM pg_temp.handoff_check((SELECT quantity=4 FROM public.commerce_cart_lines WHERE cart_id=source AND voucher_token IS NULL AND negotiated_unit_price_minor IS NULL),'ordinary lane picked attachment sibling');
  PERFORM pg_temp.handoff_check((SELECT quantity=3 FROM public.commerce_cart_lines WHERE cart_id=source AND negotiated_unit_price_minor=1470),'1470 negotiation lane selected wrong sibling');
  PERFORM pg_temp.handoff_check((SELECT expires_at=created_at+interval '7 days' FROM public.commerce_carts WHERE id=source),'merge source exceeded absolute lifetime');
  PERFORM pg_temp.handoff_check((SELECT expires_at=created_at+interval '7 days' FROM public.commerce_cart_grants WHERE id=(r->>'grantId')::uuid),'merge grant exceeded own absolute lifetime');
  replay:=public.commerce_cart_redeem_handoff('attachment-lifetime',h,'attachment-merge','merge','native',dest,1,1,lines,'[]');
  PERFORM pg_temp.handoff_check(replay->>'ok'='true' AND replay->>'replayed'='true','attachment merge response-loss replay failed');
 END IF;
END $$;
-- Caller binding: a token minted for one destination type must not
-- redeem through the other caller label, regardless of Origin claims.
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111';
 source uuid:='aaaaaaaa-3000-4000-8000-000000000003'; dest uuid:='aaaaaaaa-3000-4000-8000-000000000004';
 sg uuid:='bbbbbbbb-3000-4000-8000-000000000003'; dg uuid:='bbbbbbbb-3000-4000-8000-000000000004';
 hweb uuid:='cccccccc-3000-4000-8000-000000000011'; hnative uuid:='cccccccc-3000-4000-8000-000000000012'; r jsonb;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
 (source,m,now(),now()+interval '1 hour'),(dest,m,now(),now()+interval '1 hour');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
 (sg,m,source,'caller-source',now(),now()+interval '1 hour'),
 (dg,m,dest,'caller-receiver',now(),now()+interval '1 hour');
 PERFORM pg_temp.handoff_claim(source,sg,'caller-source');
 r:=public.commerce_cart_issue_handoff('caller-binding-web',hweb,source,'caller-issue-web','{"type":"web"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','web-destined issue rejected');
 r:=public.commerce_cart_issue_handoff('caller-binding-native',hnative,source,'caller-issue-native','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','native-destined issue rejected');
 PERFORM pg_temp.handoff_claim(dest,dg,'caller-receiver');
 r:=public.commerce_cart_redeem_handoff('caller-binding-web',hweb,'caller-web-as-native','connect','native',dest,1,1,'[]','[]');
 PERFORM pg_temp.handoff_check(r->>'code'='unauthorized','web-destined token redeemed as native');
 r:=public.commerce_cart_redeem_handoff('caller-binding-native',hnative,'caller-native-as-web','connect','web',dest,1,1,'[]','[]');
 PERFORM pg_temp.handoff_check(r->>'code'='unauthorized','native-destined token redeemed as web');
END $$;
-- Independent single-lane flows prove expiry failures even before sibling fix.
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 source uuid; dest uuid; sg uuid; dg uuid; h uuid; r jsonb; n integer; lines jsonb;
BEGIN
 FOR n IN 1..4 LOOP
  source:=('aaaaaaaa-3100-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid;
  dest:=('aaaaaaaa-3100-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid;
  sg:=('bbbbbbbb-3100-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid;
  dg:=('bbbbbbbb-3100-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid;
  h:=('cccccccc-3100-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
   (source,m,now()-interval '7 days'+interval '2 minutes',now()+interval '1 minute'),
   (dest,m,now()-interval '7 days'+interval '3 minutes',now()+interval '1 minute');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
   (sg,m,source,'cap-origin-'||n,now()-interval '7 days'+interval '90 seconds',now()+interval '1 minute'),
   (dg,m,dest,'cap-receiver-'||n,now()-interval '7 days'+interval '100 seconds',now()+interval '1 minute');
  IF n=2 THEN
   INSERT INTO public.commerce_cart_grants(merchant_id,cart_id,principal_id,created_at,expires_at)
    VALUES(m,source,'cap-receiver-'||n,now()-interval '7 days'+interval '40 seconds',now()+interval '30 seconds');
  END IF;
  INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor,negotiated_unit_price_minor,negotiation_status)
   VALUES(m,source,p,2,1500,1470,'accepted'),(m,dest,p,3,1500,1480,'accepted');
  INSERT INTO public.commerce_cart_handoffs(id,handoff_hash,merchant_id,source_cart_id,expires_at,destination)
   VALUES(h,'cap-flow-'||n,m,source,now()+interval '1 minute','{"type":"native"}');
  PERFORM pg_temp.handoff_claim(dest,dg,'cap-receiver-'||n);
  IF n<=2 THEN
   r:=public.commerce_cart_redeem_handoff('cap-flow-'||n,h,'cap-attempt-'||n,'connect','native',dest,1,NULL,NULL,'[]');
   PERFORM pg_temp.handoff_check(r->>'ok'='true','near-deadline connect rejected '||n);
   PERFORM pg_temp.handoff_check((SELECT g.expires_at<=g.created_at+interval '7 days' AND g.expires_at<=c.created_at+interval '7 days' FROM public.commerce_cart_grants g JOIN public.commerce_carts c ON c.id=g.cart_id WHERE g.id=(r->>'grantId')::uuid),'connect grant exceeded absolute deadline '||n);
  ELSE
   lines:=jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',CASE WHEN n=3 THEN 2 ELSE 3 END));
   IF n=4 THEN
    SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',quantity,'sourceLineId',id)) INTO lines
    FROM public.commerce_cart_lines WHERE cart_id IN(source,dest);
   END IF;
   r:=public.commerce_cart_redeem_handoff('cap-flow-'||n,h,'cap-attempt-'||n,'merge','native',dest,1,1,lines,'[]');
   PERFORM pg_temp.handoff_check(r->>'code'='merge_conflict','lone differing attachments did not require choice');
   r:=public.commerce_cart_redeem_handoff('cap-flow-'||n,h,'cap-attempt-'||n,'merge','native',dest,1,1,lines,jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p),'keep',CASE WHEN n=3 THEN 'incoming' ELSE 'existing' END)));
   PERFORM pg_temp.handoff_check(r->>'ok'='true','explicit conflict choice rejected '||n);
   PERFORM pg_temp.handoff_check((SELECT count(*)=1 AND min(negotiated_unit_price_minor)=CASE WHEN n=3 THEN 1470 ELSE 1480 END AND min(quantity)=CASE WHEN n=3 THEN 2 ELSE 3 END FROM public.commerce_cart_lines WHERE cart_id=source),'conflict selected wrong attachment lane '||n);
   PERFORM pg_temp.handoff_check((SELECT expires_at=created_at+interval '7 days' FROM public.commerce_carts WHERE id=source),'single-lane merge source exceeded deadline '||n);
   PERFORM pg_temp.handoff_check((SELECT g.expires_at<=c.created_at+interval '7 days' FROM public.commerce_cart_grants g JOIN public.commerce_carts c ON c.id=g.cart_id WHERE g.id=(r->>'grantId')::uuid),'new merge grant exceeded canonical cart deadline '||n);
  END IF;
 END LOOP;
END $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 source uuid:='aaaaaaaa-3200-4000-8000-000000000001'; dest uuid:='aaaaaaaa-3200-4000-8000-000000000002';
 sg uuid:='bbbbbbbb-3200-4000-8000-000000000001'; dg uuid:='bbbbbbbb-3200-4000-8000-000000000002';
 h uuid:='cccccccc-3200-4000-8000-000000000001'; r jsonb; lines jsonb;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
  (source,m,now()-interval '7 days'+interval '40 seconds',now()+interval '10 minutes'),
  (dest,m,now()-interval '1 day',now()+interval '10 minutes');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
  (sg,m,source,'bounded-origin',now()-interval '7 days'+interval '50 seconds',now()+interval '10 minutes'),
  (dg,m,dest,'bounded-receiver',now()-interval '1 day',now()+interval '10 minutes');
 PERFORM pg_temp.handoff_claim(source,sg,'bounded-origin');
 r:=public.commerce_cart_issue_handoff('bounded-issue',h,source,'bounded-issue','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true' AND (SELECT expires_at=now()+interval '40 seconds' FROM public.commerce_cart_handoffs WHERE id=h),'issuance exceeds source absolute deadline');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,options,last_unit_price_minor,has_assurance,assurance_rate)
 SELECT m,c,p,CASE WHEN c=source THEN 2 ELSE 3 END,jsonb_build_object('lane',n::text),1500,c=source,CASE WHEN c=source THEN 0.02 ELSE NULL END
 FROM unnest(ARRAY[source,dest]) c CROSS JOIN generate_series(1,20) n;
 SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p,'options',options),'quantity',quantity,'sourceLineId',id)) INTO lines
 FROM public.commerce_cart_lines WHERE cart_id IN(source,dest);
 PERFORM pg_temp.handoff_claim(dest,dg,'bounded-receiver');
 UPDATE public.commerce_cart_lines SET options=jsonb_build_object('lane',((options->>'lane')::integer+20)::text) WHERE cart_id=dest;
 SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p,'options',options),'quantity',quantity,'sourceLineId',id)) INTO lines
 FROM public.commerce_cart_lines WHERE cart_id IN(source,dest);
 r:=public.commerce_cart_redeem_handoff('bounded-issue',h,'bounded-overflow','merge','native',dest,1,1,lines,'[]');
 PERFORM pg_temp.handoff_check(r->>'code'='invalid_item' AND (SELECT version=1 FROM public.commerce_carts WHERE id=source),'40 distinct canonical lanes accepted or partially wrote');
 UPDATE public.commerce_cart_lines SET options=jsonb_build_object('lane',((options->>'lane')::integer-20)::text) WHERE cart_id=dest;
 SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p,'options',options),'quantity',quantity,'sourceLineId',id)) INTO lines
 FROM public.commerce_cart_lines WHERE cart_id IN(source,dest);
 r:=public.commerce_cart_redeem_handoff('bounded-issue',h,'bounded-merge','merge','native',dest,1,1,lines,'[]');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','40 bounded references to 20 canonical lanes rejected');
 PERFORM pg_temp.handoff_check((SELECT count(*)=20 AND min(quantity)=3 AND bool_and(has_assurance) FROM public.commerce_cart_lines WHERE cart_id=source),'ref union canonical max quantity or assurance OR failed');
END $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 source uuid:='aaaaaaaa-3300-4000-8000-000000000001'; dest uuid:='aaaaaaaa-3300-4000-8000-000000000002';
 source2 uuid:='aaaaaaaa-3300-4000-8000-000000000003'; dest2 uuid:='aaaaaaaa-3300-4000-8000-000000000004';
 sg uuid:='bbbbbbbb-3300-4000-8000-000000000001'; dg uuid:='bbbbbbbb-3300-4000-8000-000000000002';
 sg2 uuid:='bbbbbbbb-3300-4000-8000-000000000003'; dg2 uuid:='bbbbbbbb-3300-4000-8000-000000000004';
 h uuid:='cccccccc-3300-4000-8000-000000000001'; h2 uuid:='cccccccc-3300-4000-8000-000000000002';
 r jsonb; lines jsonb;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
  (source,m,now()-interval '1 day',now()+interval '10 minutes'),
  (dest,m,now()-interval '1 day',now()+interval '10 minutes'),
  (source2,m,now()-interval '1 day',now()+interval '10 minutes'),
  (dest2,m,now()-interval '1 day',now()+interval '10 minutes');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
  (sg,m,source,'chosen-origin',now()-interval '1 day',now()+interval '10 minutes'),
  (dg,m,dest,'chosen-receiver',now()-interval '1 day',now()+interval '10 minutes'),
  (sg2,m,source2,'chosen-origin2',now()-interval '1 day',now()+interval '10 minutes'),
  (dg2,m,dest2,'chosen-receiver2',now()-interval '1 day',now()+interval '10 minutes');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor,negotiated_unit_price_minor,negotiation_status) VALUES
  (m,source,p,2,1500,2000,'accepted'),
  (m,dest,p,5,1500,2200,'accepted'),
  (m,source2,p,2,1500,2000,'accepted'),
  (m,dest2,p,5,1500,2200,'accepted');
 PERFORM pg_temp.handoff_claim(source,sg,'chosen-origin');
 r:=public.commerce_cart_issue_handoff('chosen-quantity',h,source,'chosen-issue','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','chosen quantity issue rejected');
 SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',quantity,'sourceLineId',id)) INTO lines
 FROM public.commerce_cart_lines WHERE cart_id=source;
 PERFORM pg_temp.handoff_claim(dest,dg,'chosen-receiver');
 r:=public.commerce_cart_redeem_handoff('chosen-quantity',h,'chosen-incoming','merge','native',dest,1,1,lines,
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p),'keep','incoming')));
 PERFORM pg_temp.handoff_check(r->>'ok'='true','keep incoming with chosen quantity 2 rejected: '||r::text);
 PERFORM pg_temp.handoff_check((SELECT quantity=2 AND negotiated_unit_price_minor=2000 FROM public.commerce_cart_lines WHERE cart_id=source AND product_id=p),'keep incoming must keep quantity 2');
 PERFORM pg_temp.handoff_claim(source2,sg2,'chosen-origin2');
 r:=public.commerce_cart_issue_handoff('chosen-quantity-2',h2,source2,'chosen-issue2','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','chosen quantity issue 2 rejected');
 SELECT jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',p),'quantity',quantity,'sourceLineId',id)) INTO lines
 FROM public.commerce_cart_lines WHERE cart_id=dest2;
 PERFORM pg_temp.handoff_claim(dest2,dg2,'chosen-receiver2');
 r:=public.commerce_cart_redeem_handoff('chosen-quantity-2',h2,'chosen-existing','merge','native',dest2,1,1,lines,
   jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',p),'keep','existing')));
 PERFORM pg_temp.handoff_check(r->>'ok'='true','keep existing with chosen quantity 5 rejected: '||r::text);
 PERFORM pg_temp.handoff_check((SELECT quantity=5 AND negotiated_unit_price_minor=2200 FROM public.commerce_cart_lines WHERE cart_id=source2 AND product_id=p),'keep existing must keep quantity 5');
END $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 source uuid:='aaaaaaaa-3400-4000-8000-000000000001'; sg uuid:='bbbbbbbb-3400-4000-8000-000000000001';
 h uuid:='cccccccc-3400-4000-8000-000000000001'; r jsonb; stored_hash text;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES (source,m,now()-interval '1 day',now()+interval '10 minutes');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES (sg,m,source,'preview-origin',now()-interval '1 day',now()+interval '10 minutes');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor) VALUES (m,source,p,1,1500);
 PERFORM pg_temp.handoff_claim(source,sg,'preview-origin');
 r:=public.commerce_cart_issue_handoff(encode(pg_catalog.sha256('preview-raw-token'::bytea),'hex'),h,source,'preview-issue','{"type":"native"}');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','preview token issue rejected');
 SELECT handoff_hash INTO stored_hash FROM public.commerce_cart_handoffs WHERE id=h;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_previewer','cart_handoff_id',h)::text,true);
 PERFORM pg_temp.handoff_check(public.commerce_cart_handoff_merchant(h,'preview-raw-token')=m,'merchant locator must accept the raw token');
 PERFORM pg_temp.handoff_check(public.commerce_cart_handoff_merchant(h,stored_hash) IS NULL,'merchant locator must reject the stored hash as a credential');
 PERFORM pg_temp.handoff_check(public.commerce_cart_handoff_merchant(h,'wrong-token') IS NULL,'merchant locator must reject a wrong token');
 r:=public.commerce_cart_preview_handoff(h,'preview-raw-token');
 PERFORM pg_temp.handoff_check(r->>'ok'='true','preview must accept the raw token: '||r::text);
 r:=public.commerce_cart_preview_handoff(h,stored_hash);
 PERFORM pg_temp.handoff_check(r->>'code'='not_found','preview must reject the stored hash as a credential: '||r::text);
 r:=public.commerce_cart_preview_handoff(h,'wrong-token');
 PERFORM pg_temp.handoff_check(r->>'code'='not_found','preview must reject a wrong token: '||r::text);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_previewer','cart_handoff_id',source)::text,true);
 PERFORM pg_temp.handoff_check(public.commerce_cart_handoff_merchant(h,'preview-raw-token') IS NULL,'locator must reject wrong handoff claim');
 r:=public.commerce_cart_preview_handoff(h,'preview-raw-token');
 PERFORM pg_temp.handoff_check(r->>'code'='not_found','preview must reject wrong handoff claim');
END $$;
DO $$ DECLARE failures text; BEGIN SELECT string_agg(message,E'\n') INTO failures FROM handoff_failures; IF failures IS NOT NULL THEN RAISE EXCEPTION E'Handoff attachment/lifetime regressions:\n%',failures; END IF; END $$;
