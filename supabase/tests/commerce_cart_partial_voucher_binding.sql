-- Final binding + actual financial order leaf; partial metadata is omitted by
-- normal checkout payload builders and must never become award authority.
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='33333333-3333-4333-8333-333333333333';
 c uuid; g uuid; sid uuid; lid uuid; snapshot jsonb; args jsonb; r jsonb; n integer; call_count bigint;
BEGIN
 UPDATE public.merchants SET vat_registration_status='not_registered' WHERE id=m;
 UPDATE public.product_offers SET stock_quantity=20 WHERE product_id=p;
 FOR n IN 1..4 LOOP
  c:=('aaaaaaaa-4700-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  g:=('bbbbbbbb-4700-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day');
  INSERT INTO commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES(g,m,c,'partial-pair-'||n,now()+interval '1 day');
  INSERT INTO commerce_cart_lines(merchant_id,cart_id,product_id,condition,quantity,last_unit_price_minor,voucher_token,voucher_award_id)
  VALUES(m,c,p,'used',1,1000,CASE WHEN n IN(1,3) THEN 'token-only' ELSE NULL END,
    CASE WHEN n IN(2,4) THEN 'dddddddd-4700-4000-8000-000000000001'::uuid ELSE NULL END) RETURNING id INTO lid;
  snapshot:=commerce_cart_build_checkout_snapshot(m,c);
  INSERT INTO commerce_cart_checkout_sessions(merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,preparing_grant_id,reviewed_snapshot,expires_at)
  VALUES(m,c,1,1,'partial-pair-'||n,g,snapshot,now()+interval '30 minutes') RETURNING id INTO sid;
  IF n<=2 THEN
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',m)::text,true);
  ELSE
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','agentic_context','checkout','agentic_merchant_id',m)::text,true);
  END IF;
  args:=jsonb_build_object('p_merchant_id',m,'p_cart_id',c,'p_cart_version',1,'p_cart_principal_id','partial-pair-'||n,
   'p_customer_email','fixture@example.invalid','p_customer_name','Fixture','p_checkout_idempotency_key','partial-pair-'||n,
   'p_checkout_request_hash','partial-pair-v1-'||n,'p_expected_total',10,
   'p_items',jsonb_build_array(jsonb_build_object('cart_line_id',lid,'product_id',p,'condition','used','quantity',1,'price',10,'variant_attributes','{}'::jsonb)));
  -- Incomplete canonical metadata cannot authorize a forged award echo. Exact
  -- cart-line identity and quantity checks still reject mismatched payloads.
  IF n<=2 THEN
   SELECT count(*) INTO call_count FROM agentic_binding_calls;
   BEGIN
    PERFORM create_storefront_order_with_cart_binding('base',sid,1,
      jsonb_set(args,'{p_items,0,voucher_award_id}','"dddddddd-4700-4000-8000-000000000099"'));
    RAISE EXCEPTION 'partial canonical line accepted forged order award';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_checkout_stale' THEN RAISE; END IF; END;
   BEGIN
    PERFORM create_storefront_order_with_cart_binding('base',sid,1,jsonb_set(args,'{p_items,0,cart_line_id}','"ffffffff-ffff-4fff-8fff-ffffffffffff"'));
    RAISE EXCEPTION 'partial voucher repair weakened line identity';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_checkout_stale' THEN RAISE; END IF; END;
   IF (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM call_count THEN RAISE EXCEPTION 'invalid partial voucher payload reached order execution'; END IF;
  END IF;
  r:=create_storefront_order_with_cart_binding('base',sid,1,args);
  IF r->>'ok' IS DISTINCT FROM 'true' OR
    (SELECT total=10 AND discount_amount=0 FROM orders WHERE id=(r->'order'->>'id')::uuid) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'partial voucher ordinary checkout failed or mispriced: case %, %',n,r;
  END IF;
  IF (SELECT items->0->>'voucher_award_id' IS NULL FROM agentic_binding_calls ORDER BY ctid DESC LIMIT 1) IS DISTINCT FROM true THEN RAISE EXCEPTION 'partial canonical award leaked into derived order payload'; END IF;
  SELECT count(*) INTO call_count FROM agentic_binding_calls;
  r:=create_storefront_order_with_cart_binding('base',sid,1,args);
  IF r->>'replayed' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM agentic_binding_calls) IS DISTINCT FROM call_count THEN RAISE EXCEPTION 'partial voucher checkout retry executed twice'; END IF;
 END LOOP;
END $$;
