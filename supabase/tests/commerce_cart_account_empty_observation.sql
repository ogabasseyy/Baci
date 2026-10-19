-- Actual account linker, normal persisted saved-cart state; no real customer.
UPDATE public.merchants SET premium_features='["shared_cart","shared_cart_accounts"]' WHERE id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; customer uuid:='33333333-4402-4333-8333-333333333333';
 c uuid:='aaaaaaaa-4402-4000-8000-000000000001'; saved uuid:='aaaaaaaa-4402-4000-8000-000000000002';
 g uuid:='bbbbbbbb-4402-4000-8000-000000000001'; r jsonb; first_result jsonb; original_grants bigint;
BEGIN
 INSERT INTO public.customers(id,merchant_id,user_id) VALUES(customer,m,'44444444-4402-4444-8444-444444444444');
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day'),(saved,m,now()+interval '1 day');
 INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES(g,m,c,'empty-observation-device',now()+interval '1 day');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_account_linker','exp',9999999999,'cart_scope','session',
  'cart_merchant_id',m,'cart_principal_id','empty-observation-device','cart_id',c,'cart_grant_id',g,
  'cart_customer_id',customer,'cart_account_user_id','44444444-4402-4444-8444-444444444444')::text,true);
 r:=public.commerce_cart_account_status();
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->'saved' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'fixture did not observe empty account cart %',r; END IF;
 first_result:=public.commerce_cart_prepare_account_link('{"operationId":"empty-observation-first","choice":"keep_current","expectedSavedCartId":null}');
 IF first_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'observed absence rejected with no saved cart %',first_result; END IF;
 -- Another device saves a cart after this device's successful empty read.
 INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id) VALUES(m,customer,saved);
 SELECT count(*) INTO original_grants FROM public.commerce_cart_grants WHERE merchant_id=m AND linked_customer_id=customer;
 r:=public.commerce_cart_link_account('{"operationId":"empty-observation-stale","choice":"keep_current","expectedSavedCartId":null}');
 IF r->>'code' IS DISTINCT FROM 'refresh_required' THEN RAISE EXCEPTION 'explicit empty observation bypassed saved-cart fence %',r; END IF;
 IF (SELECT cart_id FROM public.commerce_cart_customer_carts WHERE merchant_id=m AND customer_id=customer) IS DISTINCT FROM saved
  OR EXISTS(SELECT 1 FROM public.commerce_cart_account_operations WHERE merchant_id=m AND customer_id=customer AND operation_id='empty-observation-stale')
  OR (SELECT count(*) FROM public.commerce_cart_grants WHERE merchant_id=m AND linked_customer_id=customer) IS DISTINCT FROM original_grants THEN RAISE EXCEPTION 'stale empty observation partially mutated account authority'; END IF;
 r:=public.commerce_cart_prepare_account_link('{"operationId":"empty-observation-first","choice":"keep_current","expectedSavedCartId":null}');
 IF r IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'saved observation fence changed exact prepared-operation replay %',r; END IF;
 r:=public.commerce_cart_prepare_account_link(jsonb_build_object('operationId','empty-observation-refreshed','choice','keep_current','expectedSavedCartId',saved));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fresh observed saved identity rejected %',r; END IF;
 r:=public.commerce_cart_prepare_account_link('{"operationId":"empty-observation-legacy","choice":"keep_current"}');
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'omitted observation backward compatibility changed %',r; END IF;
END $$;
