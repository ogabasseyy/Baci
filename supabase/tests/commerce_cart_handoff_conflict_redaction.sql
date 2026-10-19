-- Disposable full-chain fixture. A failed merge must not transfer source credentials.
DO $$ DECLARE merchant uuid:='11111111-1111-4111-8111-111111111111'; source uuid:='aaaaaaaa-1000-4000-8000-000000000004'; dest uuid:='aaaaaaaa-1000-4000-8000-000000000005'; product uuid:='44444444-4444-4444-8444-444444444444'; r jsonb; secret_source text:='source-private-voucher'; secret_dest text:='receiver-private-voucher';
BEGIN
 UPDATE public.merchants SET premium_features='["shared_cart"]' WHERE id=merchant;
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(source,merchant,now()+interval '7 days'),(dest,merchant,now()+interval '7 days');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
 ('bbbbbbbb-1000-4000-8000-000000000004',merchant,source,'source-conflict-device',now()+interval '7 days'),
 ('bbbbbbbb-1000-4000-8000-000000000005',merchant,dest,'receiver-conflict-device',now()+interval '7 days');
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,voucher_token,voucher_award_id,negotiated_unit_price_minor,negotiation_status,last_unit_price_minor) VALUES
 (merchant,source,product,1,secret_source,'dddddddd-1000-4000-8000-000000000004',100,'accepted',1500),
 (merchant,dest,product,1,secret_dest,'dddddddd-1000-4000-8000-000000000005',200,'accepted',1500);
 INSERT INTO public.commerce_cart_handoffs(id,handoff_hash,merchant_id,source_cart_id,expires_at,destination) VALUES
 ('cccccccc-1000-4000-8000-000000000004','redaction-conflict',merchant,source,now()+interval '5 minutes','{"type":"native"}');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id',merchant,'cart_principal_id','receiver-conflict-device','cart_id',dest,'cart_grant_id','bbbbbbbb-1000-4000-8000-000000000005')::text,true);
 r:=public.commerce_cart_redeem_handoff('redaction-conflict','cccccccc-1000-4000-8000-000000000004','redaction-attempt','merge','native',dest,1,1,jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',product),'quantity',1)),'[]');
 IF r->>'code' IS DISTINCT FROM 'merge_conflict' THEN RAISE EXCEPTION 'Expected attachment conflict %',r; END IF;
 IF r->'conflicts'->0->'existing' ?| ARRAY['voucherToken','voucherAwardId','negotiatedUnitPriceMinor','negotiationStatus'] OR r->'conflicts'->0->'incoming' ?| ARRAY['voucherToken','voucherAwardId','negotiatedUnitPriceMinor','negotiationStatus'] THEN RAISE EXCEPTION 'Conflict leaked private attachment keys %',r->'conflicts'; END IF;
 IF (r->'conflicts')::text LIKE '%'||secret_source||'%' OR (r->'conflicts')::text LIKE '%'||secret_dest||'%' THEN RAISE EXCEPTION 'Conflict leaked voucher values'; END IF;
 IF r->'conflicts'->0->'incoming'->>'hasVoucher' IS DISTINCT FROM 'true' OR r->'conflicts'->0->'existing'->>'hasNegotiation' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Safe offer-presence choices were lost'; END IF;
 IF (SELECT voucher_token FROM public.commerce_cart_lines WHERE cart_id=source) IS DISTINCT FROM secret_source THEN RAISE EXCEPTION 'Redaction changed stored credentials'; END IF;
 r:=public.commerce_cart_redeem_handoff('redaction-conflict','cccccccc-1000-4000-8000-000000000004','redaction-resolved','merge','native',dest,1,1,jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',product),'quantity',1)),jsonb_build_array(jsonb_build_object('item',jsonb_build_object('productId',product),'keep','incoming')));
 IF r->>'ok' IS DISTINCT FROM 'true' OR (SELECT voucher_token FROM public.commerce_cart_lines WHERE cart_id=source) IS DISTINCT FROM secret_source THEN RAISE EXCEPTION 'Resolved merge did not preserve selected private credential %',r; END IF;
END $$;
