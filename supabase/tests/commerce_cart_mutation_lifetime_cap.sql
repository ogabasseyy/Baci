-- Loaded after final cart functions in an owned disposable database.
-- A live cart/grant can be aged independently; mutation must respect each birth.
INSERT INTO public.commerce_carts(id,merchant_id,created_at,expires_at) VALUES
 ('aaaaaaaa-3000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',now()-interval '6 days',now()+interval '8 hours');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,created_at,expires_at) VALUES
 ('bbbbbbbb-3000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-3000-4000-8000-000000000001','absolute-lifetime-device',now()-interval '5 days',now()+interval '4 hours');
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-3000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444',1,1500);
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"absolute-lifetime-device","cart_id":"aaaaaaaa-3000-4000-8000-000000000001","cart_grant_id":"bbbbbbbb-3000-4000-8000-000000000001"}';
DO $$ DECLARE r jsonb; line_id uuid; cart_expiry timestamptz; grant_expiry timestamptz; failures text:=''; BEGIN
 IF has_function_privilege('commerce_cart_shopper','public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'cap repair opened private mutation executor'; END IF;
 SELECT id INTO STRICT line_id FROM public.commerce_cart_lines WHERE cart_id='aaaaaaaa-3000-4000-8000-000000000001';
 r:=public.commerce_cart_mutate('aaaaaaaa-3000-4000-8000-000000000001','absolute-lifetime-change',1,jsonb_build_object('type','set_assurance','lineId',line_id,'hasAssurance',true));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lifetime fixture mutation failed %',r; END IF;
 IF (SELECT expires_at IS NOT DISTINCT FROM created_at+interval '7 days' FROM public.commerce_carts WHERE id='aaaaaaaa-3000-4000-8000-000000000001') IS DISTINCT FROM true THEN failures:=failures||E'cart renewal exceeded absolute lifetime\n'; END IF;
 IF (SELECT expires_at IS NOT DISTINCT FROM created_at+interval '7 days' FROM public.commerce_cart_grants WHERE id='bbbbbbbb-3000-4000-8000-000000000001') IS DISTINCT FROM true THEN failures:=failures||E'grant renewal exceeded absolute lifetime\n'; END IF;
 IF failures<>'' THEN RAISE EXCEPTION E'Mutation lifetime regressions:\n%',failures; END IF;
 -- Explicitly shorten otherwise-live expiries. No-op and replay must keep
 -- these exact shorter values, with no new version/outbox transition.
 UPDATE public.commerce_carts SET expires_at=now()+interval '30 minutes' WHERE id='aaaaaaaa-3000-4000-8000-000000000001' RETURNING expires_at INTO cart_expiry;
 UPDATE public.commerce_cart_grants SET expires_at=now()+interval '20 minutes' WHERE id='bbbbbbbb-3000-4000-8000-000000000001' RETURNING expires_at INTO grant_expiry;
 r:=public.commerce_cart_mutate('aaaaaaaa-3000-4000-8000-000000000001','absolute-lifetime-noop',2,jsonb_build_object('type','set_assurance','lineId',line_id,'hasAssurance',true));
 IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'currentVersion')::integer IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'no-op lifetime mutation changed version %',r; END IF;
 r:=public.commerce_cart_mutate('aaaaaaaa-3000-4000-8000-000000000001','absolute-lifetime-change',1,jsonb_build_object('type','set_assurance','lineId',line_id,'hasAssurance',true));
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lifetime replay changed retry contract %',r; END IF;
 IF (SELECT expires_at FROM public.commerce_carts WHERE id='aaaaaaaa-3000-4000-8000-000000000001') IS DISTINCT FROM cart_expiry OR (SELECT expires_at FROM public.commerce_cart_grants WHERE id='bbbbbbbb-3000-4000-8000-000000000001') IS DISTINCT FROM grant_expiry THEN RAISE EXCEPTION 'replay or no-op renewed shorter expiry'; END IF;
 IF (SELECT count(*) FROM public.commerce_cart_events WHERE cart_id='aaaaaaaa-3000-4000-8000-000000000001') IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'replay/no-op created an outbox transition'; END IF;
END $$;
