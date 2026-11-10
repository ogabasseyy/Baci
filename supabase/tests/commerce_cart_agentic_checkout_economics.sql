-- Final binding + actual final financial leaf, with captured public RPC args.
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='33333333-3333-4333-8333-333333333333';
 c uuid; g uuid; sid uuid; line_id uuid; snapshot jsonb; r jsonb; args jsonb; n integer; count_before bigint; dispatch_marker_before bigint; variant text;
BEGIN
 FOR n IN 1..11 LOOP
  c:=('aaaaaaaa-4600-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  g:=('bbbbbbbb-4600-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  UPDATE public.merchants SET vat_registration_status=CASE WHEN n IN (5,6,8) THEN 'registered' ELSE 'not_registered' END WHERE id=m;
  INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES(g,m,c,'agentic-economics-'||n,now()+interval '1 day');
  INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,condition,quantity,last_unit_price_minor,negotiated_unit_price_minor,negotiation_status,has_assurance,assurance_rate,voucher_token,voucher_award_id)
  VALUES(m,c,p,'used',2,1000,CASE WHEN n IN(1,5,6) THEN 980 ELSE NULL END,CASE WHEN n IN(1,5,6) THEN 'accepted' ELSE NULL END,n IN(1,7,8,9,10,11),CASE WHEN n=1 THEN 0.05 WHEN n IN(8,9,11) THEN 0.09 ELSE NULL END,
   CASE WHEN n=2 THEN 'voucher-secret' ELSE NULL END,CASE WHEN n=2 THEN 'dddddddd-4600-4000-8000-000000000001'::uuid ELSE NULL END) RETURNING id INTO line_id;
  UPDATE public.product_offers SET stock_quantity=20 WHERE product_id=p;
  snapshot:=public.commerce_cart_build_checkout_snapshot(m,c);
  INSERT INTO public.commerce_cart_checkout_sessions(merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,preparing_grant_id,reviewed_snapshot,expires_at)
   VALUES(m,c,1,1,'agentic-economics-'||n,g,snapshot,now()+interval '30 minutes') RETURNING id INTO sid;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','agentic_context','checkout','agentic_merchant_id',m)::text,true);
  args:=jsonb_build_object('p_merchant_id',m,'p_cart_id',c,'p_cart_version',1,'p_cart_principal_id','agentic-economics-'||n,
    'p_customer_email','fixture@example.invalid','p_customer_name','Fixture','p_items','[]'::jsonb,'p_checkout_idempotency_key','agentic-economics-'||n,
    'p_checkout_request_hash','agentic-v1-'||n,'p_shipping_fee',2,'p_gift_wrapping_fee',1);
  IF n IN (10,11) THEN
   -- Shopper route echoes assurance explicitly; its fee is independently
   -- checked against the reviewed line, including a non-default rate.
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',m)::text,true);
   args:=args||jsonb_build_object('p_expected_total',CASE WHEN n=11 THEN 24.8 ELSE 23 END,
     'p_items',jsonb_build_array(jsonb_build_object('cart_line_id',line_id,'product_id',p,'condition','used',
       'variant_attributes','{}'::jsonb,'quantity',2,'price',10,'has_assurance',true,
       'assurance_fee',CASE WHEN n=11 THEN 1.8 ELSE 0 END)));
  END IF;
  IF n=9 THEN
   -- Preserve cart version while simulating an out-of-band assurance repricing
   -- after prepare. Current assurance must still match the reviewed snapshot.
   UPDATE public.commerce_cart_lines SET assurance_rate=0.1 WHERE id=line_id;
  END IF;
  IF n IN (7,9,10) THEN
   -- Sequence advancement survives the exception subtransaction rollback.
   SELECT last_value INTO dispatch_marker_before FROM public.agentic_binding_dispatch_seq;
   SELECT count(*) INTO count_before FROM agentic_binding_calls;
   BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base',sid,1,args);
    RAISE EXCEPTION 'selected assurance with missing or changed rate reached order dispatch (case %) ',n;
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('cart_checkout_stale') THEN RAISE; END IF;
   END;
   IF (SELECT last_value FROM public.agentic_binding_dispatch_seq) IS DISTINCT FROM dispatch_marker_before
     OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM count_before
     OR (SELECT state FROM commerce_carts WHERE id=c) IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'stale assurance case % executed order or completed cart',n;
   END IF;
   CONTINUE;
  END IF;
  IF n=2 THEN
   SELECT last_value INTO dispatch_marker_before FROM public.agentic_binding_dispatch_seq;
   SELECT count(*) INTO count_before FROM agentic_binding_calls;
   FOREACH variant IN ARRAY ARRAY['base','savings','discount_code'] LOOP
    BEGIN
     PERFORM public.create_storefront_order_with_cart_binding(variant,sid,1,args);
     RAISE EXCEPTION 'voucher % dispatch executed without award authority',variant;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_order_voucher_authority_required' THEN RAISE; END IF; END;
   END LOOP;
   IF (SELECT last_value FROM public.agentic_binding_dispatch_seq) IS DISTINCT FROM dispatch_marker_before
     OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM count_before
     OR (SELECT state FROM commerce_carts WHERE id=c) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'rejected voucher executed order or completed cart'; END IF;
   CONTINUE;
  ELSIF n=3 THEN args:=args||'{"p_discount_amount":999,"p_expected_total":1}';
  ELSIF n IN (5,6,8) THEN args:=args||jsonb_build_object('p_tax_amount',1.5,'p_tax_basis',CASE WHEN n=5 THEN 'exclusive' ELSE 'inclusive' END);
  ELSIF n=4 THEN
   -- Normal storefront route keeps its separately validated discount contract.
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',m)::text,true);
   args:=args||jsonb_build_object('p_discount_amount',0.1,'p_expected_total',22.9,'p_items',jsonb_build_array(jsonb_build_object('cart_line_id',line_id,'product_id',p,'condition','used','variant_attributes','{}'::jsonb,'quantity',2,'price',10)));
  END IF;
  r:=public.create_storefront_order_with_cart_binding('base',sid,1,args);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'financial binding failed %',r; END IF;
  IF n=1 THEN
   IF (SELECT discount=0.4 AND expected=23.58 FROM agentic_binding_calls ORDER BY ctid DESC LIMIT 1) IS DISTINCT FROM true THEN RAISE EXCEPTION 'agentic captured discount/expected did not use reviewed negotiation+assurance'; END IF;
   IF (SELECT total=23.58 AND discount_amount=0.4 AND subtotal=20.98 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'actual committed financial total ignored negotiation'; END IF;
   SELECT count(*) INTO count_before FROM agentic_binding_calls;
   r:=public.create_storefront_order_with_cart_binding('base',sid,1,args);
   IF r->>'replayed' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM count_before THEN RAISE EXCEPTION 'financial binding replay executed order twice'; END IF;
  ELSIF n=3 THEN
   IF (SELECT total=23 AND discount_amount=0 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'agentic caller discount/expected overrode reviewed economics'; END IF;
  ELSIF n IN (5,6) THEN
   IF (SELECT total=24.1 AND tax_basis='exclusive' AND discount_amount=0.4 AND tax_amount=1.5 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'agentic VAT basis total diverged from reviewed economics'; END IF;
  ELSIF n=4 THEN
   IF (SELECT total=22.9 AND discount_amount=0.1 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'ordinary route discount contract changed'; END IF;
  ELSIF n=8 THEN
   IF (SELECT total=26.3 AND discount_amount=0 AND tax_amount=1.5 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true
     OR (SELECT (items->0->>'assurance_fee')::numeric=1.8 AND expected=26.3 FROM agentic_binding_calls ORDER BY ctid DESC LIMIT 1) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'agentic checkout did not preserve the reviewed 9%% assurance rate';
   END IF;
   SELECT count(*) INTO count_before FROM agentic_binding_calls;
   r:=public.create_storefront_order_with_cart_binding('base',sid,1,args);
   IF r->>'replayed' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM count_before THEN
    RAISE EXCEPTION '9%% assurance checkout replay executed the order twice';
   END IF;
  ELSIF n=11 THEN
   IF (SELECT total=24.8 AND discount_amount=0 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true
     OR (SELECT (items->0->>'assurance_fee')::numeric=1.8 AND expected=24.8 FROM agentic_binding_calls ORDER BY ctid DESC LIMIT 1) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'route checkout did not preserve the reviewed 9%% assurance fee';
   END IF;
   SELECT count(*) INTO count_before FROM agentic_binding_calls;
   r:=public.create_storefront_order_with_cart_binding('base',sid,1,args);
   IF r->>'replayed' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM count_before THEN
    RAISE EXCEPTION 'route assurance checkout replay executed the order twice';
   END IF;
  END IF;
 END LOOP;
END $$;
