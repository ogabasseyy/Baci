-- Loaded after the complete cart migration chain in an empty disposable PostgreSQL.
-- Fixtures use mocked order functions, no credentials or provider calls.
CREATE TEMP TABLE review_failures(message text);
CREATE FUNCTION pg_temp.check_review(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN INSERT INTO review_failures VALUES(message); END IF; END $$;
DO $$ DECLARE parsed record; BEGIN
 SELECT * INTO parsed FROM public.commerce_cart_parse_input_line(jsonb_build_object('item',jsonb_build_object('productId','44444444-4444-4444-8444-444444444444'),'quantity',1,'voucherToken',repeat('x',400)));
 PERFORM pg_temp.check_review(parsed.pi_product IS NOT NULL,'real signed voucher length rejected');
 SELECT * INTO parsed FROM public.commerce_cart_parse_input_line(jsonb_build_object('item',jsonb_build_object('productId','44444444-4444-4444-8444-444444444444'),'quantity',1,'voucherToken',repeat('x',513)));
 PERFORM pg_temp.check_review(parsed.pi_product IS NULL,'oversized voucher accepted');
END $$;
-- Unavailable reductions preserve the last observed value; replacement collapses
-- repeated logical identities and refuses aggregate quantities beyond the cap.
UPDATE public.commerce_cart_grants SET allowed_operations=ARRAY['add','set_quantity','remove','clear','replace','set_assurance','set_negotiated_price'] WHERE id='99999999-9999-4999-8999-999999999960';
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a4","cart_id":"cccccccc-4000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999960"}';
DO $$ DECLARE r jsonb; BEGIN
 UPDATE public.commerce_cart_lines SET quantity=2,last_unit_price_minor=1500 WHERE id='dddddddd-4000-4000-8000-000000000000';
 UPDATE public.products SET status='inactive' WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_mutate('cccccccc-4000-4000-8000-000000000000','review-reduce',1,'{"type":"set_quantity","lineId":"dddddddd-4000-4000-8000-000000000000","quantity":1}');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (SELECT last_unit_price_minor=1500 FROM public.commerce_cart_lines WHERE id='dddddddd-4000-4000-8000-000000000000'),'unavailable reduction lost last price');
 UPDATE public.products SET status='active' WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_mutate('cccccccc-4000-4000-8000-000000000000','review-duplicates',2,'{"type":"replace","lines":[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":2},{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":3,"hasAssurance":true}]}');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (SELECT count(*)=1 AND sum(quantity)=5 FROM public.commerce_cart_lines WHERE cart_id='cccccccc-4000-4000-8000-000000000000'),'replacement did not collapse quantities');
 PERFORM pg_temp.check_review((SELECT has_assurance AND assurance_rate=0.05 FROM public.commerce_cart_lines WHERE cart_id='cccccccc-4000-4000-8000-000000000000'),'replace lost coverage on overlapping imported lines');
 r:=public.commerce_cart_mutate('cccccccc-4000-4000-8000-000000000000','review-duplicates-over-cap',3,'{"type":"replace","lines":[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":6},{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":6}]}');
 PERFORM pg_temp.check_review(r->>'ok'='false','replacement exceeded aggregate quantity cap');
END $$;
-- Historical overlong expiry must not revive authority beyond its absolute age.
DO $$ DECLARE r jsonb; BEGIN
 UPDATE public.commerce_carts SET created_at=now()-interval '9 days',expires_at=now()+interval '2 days' WHERE id='cccccccc-4000-4000-8000-000000000000';
 UPDATE public.commerce_cart_grants SET created_at=now()-interval '9 days',expires_at=now()+interval '2 days' WHERE id='99999999-9999-4999-8999-999999999960';
 r:=public.commerce_cart_prepare_checkout('cccccccc-4000-4000-8000-000000000000',(SELECT version FROM public.commerce_carts WHERE id='cccccccc-4000-4000-8000-000000000000'),'review-sliding');
 PERFORM pg_temp.check_review(r->>'code'='expired','prepare revived authority older than absolute lifetime');
 -- Independent subsequent pricing/binding fixtures use a live generation.
 UPDATE public.commerce_carts SET created_at=now() WHERE id='cccccccc-4000-4000-8000-000000000000';
 UPDATE public.commerce_cart_grants SET created_at=now() WHERE id='99999999-9999-4999-8999-999999999960';
END $$;
-- Reserved prizes need no remaining public stock and retain zero pricing.
DO $$ DECLARE s jsonb; BEGIN
 UPDATE public.commerce_cart_lines SET voucher_token='fixture-reserved',voucher_award_id='dddddddd-4500-4000-8000-000000000009',quantity=1 WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
 UPDATE public.products SET stock=0,stock_quantity=0 WHERE id='44444444-4444-4444-8444-444444444444';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=0 AND (s->'estimates'->>'subtotalMinor')::bigint=0,'reserved voucher blocked by public stock');
END $$;
-- Valid numeric(10,2) catalog values must survive minor-unit conversion.
DO $$ DECLARE s jsonb; BEGIN
 UPDATE public.products SET price=30000000,stock=10,stock_quantity=10 WHERE id='44444444-4444-4444-8444-444444444444';
 UPDATE public.commerce_cart_lines SET voucher_token=NULL,voucher_award_id=NULL WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
 BEGIN
  s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
  PERFORM pg_temp.check_review((s->'lines'->0->>'effectiveUnitPriceMinor')::bigint=3000000000,'large price changed');
 EXCEPTION WHEN numeric_value_out_of_range THEN PERFORM pg_temp.check_review(false,'large catalog price overflows minor units'); END;
END $$;
-- Negotiation accepted against an old lower catalog must re-enter review.
DO $$ DECLARE s jsonb; BEGIN
 UPDATE public.products SET price=15,brand='Apple',name='Fixture',stock=10,stock_quantity=10 WHERE id='44444444-4444-4444-8444-444444444444';
 UPDATE public.commerce_cart_lines SET negotiated_unit_price_minor=1470,negotiation_status='accepted' WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'lines'->0->>'effectiveUnitPriceMinor')::bigint=1470,'valid current negotiation rejected');
 UPDATE public.products SET price=20 WHERE id='44444444-4444-4444-8444-444444444444';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'lines'->0->>'effectiveUnitPriceMinor')::bigint=2000 AND (s->'lines'->0->>'negotiationInvalidated')::boolean,'stale accepted negotiation survived new floor');
 UPDATE public.commerce_cart_lines SET negotiated_unit_price_minor=NULL,negotiation_status=NULL WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
END $$;
-- Create ignores caller-selected currency and keeps migrated coverage server-priced.
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"currency-review-device"}';
DO $$ DECLARE r jsonb; BEGIN
 UPDATE public.merchants SET payout_currency=' usd ' WHERE id='11111111-1111-4111-8111-111111111111';
 r:=public.commerce_cart_create('review-currency','[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1,"hasAssurance":true,"negotiatedUnitPriceMinor":1,"negotiationStatus":"accepted"}]','GBP');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND r->'state'->>'currency'='USD','caller forged canonical currency');
 PERFORM pg_temp.check_review((r->'state'->'lines'->0->>'hasAssurance')::boolean AND (r->'state'->'lines'->0->>'assuranceRate')::numeric=0.05,'create lost server-priced assurance');
 PERFORM pg_temp.check_review(r->'state'->'lines'->0->>'negotiationStatus'='pending','create bypassed negotiation floor');
 UPDATE public.merchants SET payout_currency='bad-value',country='United Kingdom' WHERE id='11111111-1111-4111-8111-111111111111';
 r:=public.commerce_cart_create('review-currency-country','[]','NGN');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND r->'state'->>'currency'='GBP','country currency fallback lost');
 UPDATE public.merchants SET payout_currency='NGN',country=NULL WHERE id='11111111-1111-4111-8111-111111111111';
END $$;
-- Strict inventory uses available units; unlimited policy remains purchasable.
DO $$ DECLARE s jsonb; BEGIN
 INSERT INTO public.product_variants(id,product_id,merchant_id,price_override,stock_quantity,inventory_tracking_policy) VALUES('77777777-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',15,0,'serialized_strict');
 UPDATE public.commerce_cart_lines SET variant_id='77777777-3333-4333-8333-333333333333' WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
 INSERT INTO public.variant_inventory(merchant_id,product_id,variant_id,status) VALUES('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','77777777-3333-4333-8333-333333333333','available');
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=0,'serialized unit ignored raw stock zero');
 UPDATE public.variant_inventory SET status='sold';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=1,'sold serialized unit remained available');
 UPDATE public.product_variants SET inventory_tracking_policy='serialized_then_unlimited' WHERE id='77777777-3333-4333-8333-333333333333';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','cccccccc-4000-4000-8000-000000000000');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=0,'unlimited fallback ignored');
 UPDATE public.product_variants SET is_active=false WHERE id='77777777-3333-4333-8333-333333333333';
 BEGIN
  PERFORM public.commerce_cart_require_offer('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','77777777-3333-4333-8333-333333333333');
  PERFORM pg_temp.check_review(false,'inactive variant accepted at mutation boundary');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_offer' THEN RAISE; END IF; END;
 UPDATE public.commerce_cart_lines SET variant_id=NULL WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
END $$;
-- Bind preparation to the original principal's live authority and price basis.
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a4","cart_id":"cccccccc-4000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999960"}';
DO $$ DECLARE r jsonb; BEGIN
 UPDATE public.commerce_cart_lines SET has_assurance=false,assurance_rate=NULL WHERE cart_id='cccccccc-4000-4000-8000-000000000000';
 UPDATE public.products SET price=15 WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_prepare_checkout('cccccccc-4000-4000-8000-000000000000',(SELECT version FROM public.commerce_carts WHERE id='cccccccc-4000-4000-8000-000000000000'),'review-binding');
 INSERT INTO test_ctx VALUES('remaining_session',r->'snapshot'->>'checkoutSessionId'),('remaining_generation',r->'snapshot'->>'generation'),('remaining_version',r->'snapshot'->>'cartVersion');
 UPDATE public.commerce_cart_grants SET revoked_at=now() WHERE id='99999999-9999-4999-8999-999999999960';
END $$;
SET request.jwt.claims='{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE args jsonb; r jsonb; sid uuid:=(SELECT value::uuid FROM test_ctx WHERE key='remaining_session'); gen integer:=(SELECT value::integer FROM test_ctx WHERE key='remaining_generation'); ver integer:=(SELECT value::integer FROM test_ctx WHERE key='remaining_version'); BEGIN
 args:=jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111','p_customer_email','fixture@example.invalid','p_customer_name','Fixture','p_items','[{"cart_line_id":"dddddddd-4000-4000-8000-000000000000","product_id":"44444444-4444-4444-8444-444444444444","quantity":1,"price":15,"variant_attributes":{}}]'::jsonb,'p_checkout_idempotency_key','remaining-review-binding','p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',ver,'p_cart_principal_id','guest-a4');
 BEGIN PERFORM public.create_storefront_order_with_cart_binding('base',sid,gen,args); PERFORM pg_temp.check_review(false,'revoked preparing grant submitted order'); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_order_unauthorized' THEN RAISE; END IF; END;
 UPDATE public.commerce_cart_grants SET revoked_at=NULL WHERE id='99999999-9999-4999-8999-999999999960';
 UPDATE public.products SET price=16 WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","agentic_context":"checkout","agentic_merchant_id":"11111111-1111-4111-8111-111111111111"}',true);
 BEGIN PERFORM public.create_storefront_order_with_cart_binding('base',sid,gen,args); PERFORM pg_temp.check_review(false,'agentic silently changed prepared price'); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_checkout_stale' THEN RAISE; END IF; END;
 UPDATE public.products SET price=15 WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}',true);
 r:=public.create_storefront_order_with_cart_binding('base',sid,gen,args);
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (SELECT state='completed' AND version=ver+1 FROM public.commerce_carts WHERE id='cccccccc-4000-4000-8000-000000000000') AND EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE cart_id='cccccccc-4000-4000-8000-000000000000' AND version=ver+1),'checkout completion omitted versioned outbox');
 r:=public.create_storefront_order_with_cart_binding('base',sid,gen,args);
 PERFORM pg_temp.check_review((r->>'replayed')::boolean,'authorized submitted receipt did not replay');
 INSERT INTO public.commerce_cart_device_retirements(merchant_id,device_principal_id) VALUES('11111111-1111-4111-8111-111111111111','guest-a4');
 BEGIN PERFORM public.create_storefront_order_with_cart_binding('base',sid,gen,args); PERFORM pg_temp.check_review(false,'retired device replayed order receipt'); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cart_order_unauthorized' THEN RAISE; END IF; END;
END $$;
-- Agentic principal resolution is bound to persisted checkout metadata.
DO $$ DECLARE sid uuid:=(SELECT value::uuid FROM test_ctx WHERE key='remaining_session'); gen integer:=(SELECT value::integer FROM test_ctx WHERE key='remaining_generation'); ver integer:=(SELECT value::integer FROM test_ctx WHERE key='remaining_version'); BEGIN
 INSERT INTO public.checkout_sessions(id,session_id,merchant_id,metadata) VALUES(gen_random_uuid(),'review-agentic-session','11111111-1111-4111-8111-111111111111',jsonb_build_object('agentic',jsonb_build_object('shared_cart',jsonb_build_object('cart_id','cccccccc-4000-4000-8000-000000000000','checkout_session_id',sid,'checkout_generation',gen,'cart_version',ver))));
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","agentic_context":"checkout","agentic_merchant_id":"11111111-1111-4111-8111-111111111111","agentic_session_id":"review-agentic-session"}',true);
 PERFORM pg_temp.check_review(public.commerce_cart_resolve_agentic_principal('review-agentic-session',sid,'cccccccc-4000-4000-8000-000000000000')='guest-a4','scoped agentic resolution failed');
 PERFORM pg_temp.check_review(public.commerce_cart_resolve_agentic_principal('different-session',sid,'cccccccc-4000-4000-8000-000000000000') IS NULL,'agentic session boundary bypassed');
 UPDATE public.checkout_sessions SET metadata='{}';
 PERFORM pg_temp.check_review(public.commerce_cart_resolve_agentic_principal('review-agentic-session',sid,'cccccccc-4000-4000-8000-000000000000') IS NULL,'missing persisted binding resolved principal');
 PERFORM pg_temp.check_review(NOT has_function_privilege('service_role','public.commerce_cart_resolve_agentic_principal(text,uuid,uuid)','EXECUTE'),'service role can resolve agentic principal');
END $$;
-- Account receipts expose the selected grant expiry and finish rejects a cart
-- completed after preparation before updating the account pointer.
INSERT INTO public.customers(id,merchant_id,user_id) VALUES('33333333-ffff-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','44444444-ffff-4444-8444-444444444444');
UPDATE public.merchants SET premium_features='["shared_cart","shared_cart_accounts"]' WHERE id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES('22222222-ffff-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',now()+interval '10 minutes');
INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id) VALUES('11111111-1111-4111-8111-111111111111','33333333-ffff-4333-8333-333333333333','22222222-ffff-4222-8222-222222222222');
SET request.jwt.claims='{"role":"commerce_cart_account_linker","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"account-review-device","cart_customer_id":"33333333-ffff-4333-8333-333333333333","cart_account_user_id":"44444444-ffff-4444-8444-444444444444"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.commerce_cart_link_account('{"operationId":"review-account-expiry","choice":"use_saved"}');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (r->>'grantExpiresAt')::timestamptz=(SELECT expires_at FROM public.commerce_cart_grants WHERE id=(r->>'grantId')::uuid),'linked account receipt lacks selected grant expiry');
END $$;
SET request.jwt.claims='{"role":"commerce_cart_account_linker","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"account-review-second-device","cart_customer_id":"33333333-ffff-4333-8333-333333333333","cart_account_user_id":"44444444-ffff-4444-8444-444444444444"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.commerce_cart_prepare_account_link('{"operationId":"review-account-completed","choice":"use_saved"}');
 PERFORM pg_temp.check_review(r->>'ok'='true','account race fixture did not prepare');
 UPDATE public.commerce_carts SET state='completed' WHERE id='22222222-ffff-4222-8222-222222222222';
 r:=public.commerce_cart_finish_account_link('review-account-completed');
 PERFORM pg_temp.check_review(r->>'ok'='false' AND r->>'code'='refresh_required','account finish accepted completed selected cart');
END $$;
-- Full account merge follows the source handoff cart even after the receiver
-- cart is retired during the same transaction.
UPDATE public.commerce_carts SET state='active' WHERE id='22222222-ffff-4222-8222-222222222222';
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES('22222222-ffff-4222-8222-222222222223','11111111-1111-4111-8111-111111111111',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES('66666666-ffff-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','22222222-ffff-4222-8222-222222222223','account-merge-review-device',now()+interval '7 days');
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor) VALUES('11111111-1111-4111-8111-111111111111','22222222-ffff-4222-8222-222222222223','44444444-4444-4444-8444-444444444444',1,1500);
SET request.jwt.claims='{"role":"commerce_cart_account_linker","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"account-merge-review-device","cart_id":"22222222-ffff-4222-8222-222222222223","cart_grant_id":"66666666-ffff-4666-8666-666666666666","cart_customer_id":"33333333-ffff-4333-8333-333333333333","cart_account_user_id":"44444444-ffff-4444-8444-444444444444"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.commerce_cart_link_account('{"operationId":"review-account-merge","choice":"merge","expectedSavedCartId":"22222222-ffff-4222-8222-222222222222","expectedSavedVersion":1,"expectedCurrentVersion":1,"lines":[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1}]}',repeat('a',64),'88888888-ffff-4888-8888-888888888888','{"type":"web"}');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND r->>'cartId'='22222222-ffff-4222-8222-222222222222' AND (SELECT cart_id='22222222-ffff-4222-8222-222222222222' FROM public.commerce_cart_customer_carts WHERE customer_id='33333333-ffff-4333-8333-333333333333'),'account merge failed canonical source transition: '||r::text);
END $$;
-- A separate used offer has a different price/stock pool from the parent.
-- Review and acceptance now use the same condition pool as the order RPC.
DO $$ DECLARE s jsonb; BEGIN
 INSERT INTO public.product_offers(product_id,merchant_id,condition,price,stock_quantity,status) VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','used',10,1,'active');
 UPDATE public.commerce_cart_lines SET condition='used' WHERE cart_id='22222222-ffff-4222-8222-222222222222';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','22222222-ffff-4222-8222-222222222222');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=0 AND (s->'lines'->0->>'effectiveUnitPriceMinor')::bigint=1000 AND (s->'lines'->0->>'stockQty')::integer=1,'condition offer silently fell back to parent price/inventory');
 PERFORM public.commerce_cart_require_offer('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',NULL,'used');
 UPDATE public.product_offers SET status='inactive' WHERE condition='used';
 s:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','22222222-ffff-4222-8222-222222222222');
 PERFORM pg_temp.check_review((s->'estimates'->>'unavailableCount')::integer=1,'inactive condition offer reviewed as available');
 PERFORM pg_temp.check_review(public.commerce_cart_condition_supported('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',NULL,'new'),'base condition incorrectly blocked');
END $$;
-- Legacy MCP imports preserve coverage, collapse duplicate identities and
-- canonicalize currency on the database boundary.
CREATE TABLE public.mcp_guest_carts(token_hash text,version bigint,migrated_to_cart_id uuid);
INSERT INTO public.mcp_guest_carts VALUES(repeat('c',64),1,NULL);
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"legacy-review-device"}';
DO $$ DECLARE r jsonb; BEGIN
 UPDATE public.merchants SET payout_currency='USD' WHERE id='11111111-1111-4111-8111-111111111111';
 r:=public.commerce_cart_migrate_legacy('mcp',repeat('c',64),'review-legacy-assurance','[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1},{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":2,"hasAssurance":true}]','1','GBP');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND r->'state'->>'currency'='USD' AND (r->'state'->'lines'->0->>'quantity')::integer=3 AND (r->'state'->'lines'->0->>'hasAssurance')::boolean,'legacy import lost canonical currency/quantity/assurance: '||r::text);
END $$;
-- Final writer regressions: replacing an existing condition line and handoff
-- rebuilding must retain the selected offer's last price, including fallback.
UPDATE public.product_offers SET price=10,status='active',stock_quantity=10 WHERE condition='used';
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"condition-writer-source"}';
DO $$ DECLARE created jsonb; r jsonb; cart uuid; grant_id uuid; BEGIN
 created:=public.commerce_cart_create('review-condition-writer-source','[{"item":{"productId":"44444444-4444-4444-8444-444444444444","condition":"used"},"quantity":1}]','NGN');
 cart:=(created->'state'->>'id')::uuid; grant_id:=(created->>'grantId')::uuid;
 IF cart IS NULL THEN cart:=(created->'state'->>'cartId')::uuid; END IF;
 INSERT INTO test_ctx VALUES('condition_writer_source_cart',cart::text),('condition_writer_source_grant',grant_id::text);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','condition-writer-source','cart_id',cart,'cart_grant_id',grant_id)::text,true);
 r:=public.commerce_cart_mutate(cart,'review-condition-existing-replace',1,'{"type":"replace","lines":[{"item":{"productId":"44444444-4444-4444-8444-444444444444","condition":"used"},"quantity":2}]}');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (SELECT last_unit_price_minor=1000 FROM public.commerce_cart_lines WHERE cart_id=cart),'existing condition replacement last price used parent');
 UPDATE public.products SET status='inactive' WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_assemble_state('11111111-1111-4111-8111-111111111111',cart);
 PERFORM pg_temp.check_review((r->'lines'->0->>'unitPriceMinor')::bigint=1000,'unavailable replaced condition line fell back to parent price');
 UPDATE public.products SET status='active' WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_issue_handoff(repeat('d',64),'88888888-eeee-4888-8888-888888888888',cart,'condition-writer-handoff','{"type":"web"}');
 PERFORM pg_temp.check_review(r->>'ok'='true','condition handoff fixture issue failed');
END $$;
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"condition-writer-receiver"}';
DO $$ DECLARE created jsonb; r jsonb; cart uuid; grant_id uuid; source_cart uuid:=(SELECT value::uuid FROM test_ctx WHERE key='condition_writer_source_cart'); BEGIN
 created:=public.commerce_cart_create('review-condition-writer-receiver','[]','NGN');
 cart:=coalesce(created->'state'->>'id',created->'state'->>'cartId')::uuid; grant_id:=(created->>'grantId')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','condition-writer-receiver','cart_id',cart,'cart_grant_id',grant_id)::text,true);
 r:=public.commerce_cart_redeem_handoff(repeat('d',64),'88888888-eeee-4888-8888-888888888888','condition-writer-redeem','merge','web',cart,2,1,'[{"item":{"productId":"44444444-4444-4444-8444-444444444444","condition":"used"},"quantity":2}]','[]');
 PERFORM pg_temp.check_review(r->>'ok'='true' AND (SELECT last_unit_price_minor=1000 FROM public.commerce_cart_lines WHERE cart_id=source_cart),'handoff condition last price used parent');
END $$;
-- A condition offer withdrawn after link creation must be revalidated by
-- the handoff writer itself, without consuming the handoff or changing carts.
DO $$ DECLARE r jsonb; cart uuid:=(SELECT value::uuid FROM test_ctx WHERE key='condition_writer_source_cart'); grant_id uuid:=(SELECT value::uuid FROM test_ctx WHERE key='condition_writer_source_grant'); BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','condition-writer-source','cart_id',cart,'cart_grant_id',grant_id)::text,true);
 r:=public.commerce_cart_issue_handoff(repeat('e',64),'88888888-dddd-4888-8888-888888888888',cart,'condition-writer-withdrawn','{"type":"web"}');
 PERFORM pg_temp.check_review(r->>'ok'='true','withdrawn condition handoff issue fixture failed');
 UPDATE public.product_offers SET status='inactive' WHERE condition='used';
END $$;
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"condition-withdrawn-receiver"}';
DO $$ DECLARE created jsonb; r jsonb; cart uuid; grant_id uuid; source_cart uuid:=(SELECT value::uuid FROM test_ctx WHERE key='condition_writer_source_cart'); BEGIN
 created:=public.commerce_cart_create('review-condition-withdrawn-receiver','[]','NGN');
 cart:=coalesce(created->'state'->>'id',created->'state'->>'cartId')::uuid; grant_id:=(created->>'grantId')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','condition-withdrawn-receiver','cart_id',cart,'cart_grant_id',grant_id)::text,true);
 r:=public.commerce_cart_redeem_handoff(repeat('e',64),'88888888-dddd-4888-8888-888888888888','condition-withdrawn-redeem','merge','web',cart,3,1,'[{"item":{"productId":"44444444-4444-4444-8444-444444444444","condition":"used"},"quantity":2}]','[]');
 PERFORM pg_temp.check_review(r->>'ok'='false' AND r->>'code'='invalid_item' AND (SELECT version=3 FROM public.commerce_carts WHERE id=source_cart) AND (SELECT state='active' FROM public.commerce_carts WHERE id=cart) AND (SELECT redeemed_at IS NULL FROM public.commerce_cart_handoffs WHERE id='88888888-dddd-4888-8888-888888888888'),'handoff writer accepted withdrawn condition or partially committed');
END $$;
-- Cart review and raw availability must share the serialized condition gate.
DO $$ DECLARE cart uuid:=(SELECT value::uuid FROM test_ctx WHERE key='condition_writer_source_cart'); r jsonb; BEGIN
 UPDATE public.product_offers SET status='active',stock_quantity=10 WHERE condition='used';
 UPDATE public.products SET inventory_tracking_policy='serialized_strict' WHERE id='44444444-4444-4444-8444-444444444444';
 r:=public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111',cart);
 PERFORM pg_temp.check_review((r->'estimates'->>'unavailableCount')::integer=1,'serialized condition pool bypassed checkout inventory guard');
 r:=public.commerce_cart_assemble_state('11111111-1111-4111-8111-111111111111',cart);
 PERFORM pg_temp.check_review((r->'lines'->0->>'available')::boolean=false,'serialized condition pool appeared available in raw cart');
 BEGIN PERFORM public.commerce_cart_require_offer('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',NULL,'used'); PERFORM pg_temp.check_review(false,'serialized condition accepted by cart writer'); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_offer' THEN RAISE; END IF; END;
 PERFORM pg_temp.check_review(public.commerce_cart_condition_supported('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',NULL,'new'),'ordinary parent condition serialized path blocked');
 PERFORM pg_temp.check_review(public.commerce_cart_condition_supported('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','77777777-3333-4333-8333-333333333333','used'),'ordinary variant serialized path blocked');
END $$;
DO $$ DECLARE failures text; BEGIN SELECT string_agg(message,E'\n') INTO failures FROM review_failures; IF failures IS NOT NULL THEN RAISE EXCEPTION E'Review regressions:\n%',failures; END IF; END $$;
