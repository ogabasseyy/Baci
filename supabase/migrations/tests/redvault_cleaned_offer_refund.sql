-- Full-schema regression: cleanup of a mistakenly attached serialized unit
-- must not prevent a subsequent REDVAULT offer refund from restoring stock.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('test.redvault_refund_failure_phase', '0', true);
DO $$
#variable_conflict use_variable
DECLARE
 merchant_id uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
 product_id uuid := '03e10000-0000-4000-8000-000000000002';
 offer_id uuid := '03e10000-0000-4000-8000-000000000003';
 variant_id uuid := '03e10000-0000-4000-8000-000000000004';
 unit_id uuid := '03e10000-0000-4000-8000-000000000005';
 discount_id uuid := '03e10000-0000-4000-8000-000000000006';
 application_id uuid := '03e10000-0000-4000-8000-000000000007';
 attempt_id uuid := '03e10000-0000-4000-8000-000000000008';
 refund_id uuid := '03e10000-0000-4000-8000-000000000009';
 order_id uuid;
 item_id uuid;
 offer_stock integer;
 parent_stock integer;
 state text;
 phase integer := 1;
 h text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
BEGIN
 INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
 INSERT INTO public.merchants(id,email,business_name,slug,is_published)
 VALUES (merchant_id,'cleanup-refund@example.com','Cleanup refund','cleanup-refund',true)
 ON CONFLICT (id) DO NOTHING;
 phase := 2;
 INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity,manage_stock,has_condition_offers,has_variants,inventory_tracking_policy)
 VALUES (product_id,merchant_id,'Cleanup refund phone',50000,'active',12,true,true,false,'serialized_strict');
 INSERT INTO public.product_variants(id,product_id,merchant_id,attributes,price_override,inventory_tracking_policy,is_inventory_anchor)
 VALUES (variant_id,product_id,merchant_id,'{"is_anchor":true}',0,'inherit',true);
 UPDATE public.products SET inventory_anchor_variant_id=variant_id WHERE id=product_id;
 INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
 VALUES (offer_id,product_id,merchant_id,'used',50000,5,'active');
 phase := 3;
 SELECT o.id INTO order_id FROM public.create_storefront_order(
   p_merchant_id=>merchant_id,p_customer_email=>'cleanup-buyer@example.com',p_customer_name=>'Cleanup buyer',
   p_items=>jsonb_build_array(jsonb_build_object('product_id',product_id,'offer_id',offer_id,'quantity',1))) o;
 SELECT oi.id INTO STRICT item_id FROM public.order_items oi WHERE oi.order_id=order_id;
 UPDATE public.orders SET payment_method='uba_redvault' WHERE id=order_id;
 phase := 4;
 INSERT INTO public.variant_inventory(id,variant_id,merchant_id,identifier_type,identifier_value,status,order_id,order_item_id,reserved_at,first_reserved_at)
 VALUES (unit_id,variant_id,merchant_id,'serial','cleanup-refund-unit','reserved',order_id,item_id,now(),now());
 PERFORM private.record_variant_inventory_event(unit_id,merchant_id,product_id,variant_id,'reserved',
   'available','reserved',order_id,item_id,NULL,NULL,NULL,'{}'::jsonb);
 phase := 5;
 PERFORM private.release_stale_offer_line_serialized_units(merchant_id,order_id,item_id,product_id,'{}'::jsonb);
 IF private.redvault_line_was_serialized(order_id,item_id) IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'cleaned offer still routes to serialized refund';
 END IF;
 SELECT stock_quantity INTO offer_stock FROM public.product_offers WHERE id=offer_id;
 SELECT stock_quantity INTO parent_stock FROM public.products WHERE id=product_id;
 phase := 6;
 INSERT INTO public.discount_codes(id,merchant_id,code,discount_type,discount_value)
 VALUES (discount_id,merchant_id,'CLEANUPREFUND','fixed_amount',100);
 phase := 9;
 UPDATE private.uba_redvault_runtime SET commercial_terms_confirmed=true,
 commercial_terms=jsonb_build_object('campaign_dates',jsonb_build_object('starts_at','2020-01-01T00:00:00Z','ends_at','2030-01-01T00:00:00Z'),
 'minimum_spend',jsonb_build_object('eligible_subtotal_kobo',1000),'caps',jsonb_build_object('discount_kobo',1000000))
 WHERE partnership='uba_redvault';
 phase := 10;
 INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
 VALUES(application_id,order_id,discount_id,merchant_id,gen_random_uuid(),h,'{}','cleanup-buyer@example.com','CLEANUP-REFUND','CLEANUP-REFUND',100,50000,'approved');
 phase := 11;
 INSERT INTO private.uba_redvault_payment_attempts(id,application_id,order_id,merchant_id,reference,quote_payload_hash,amount_kobo,currency,state,provider_response)
 VALUES(attempt_id,application_id,order_id,merchant_id,'CLEANUP-REFUND',h,50000,'NGN','approved',NULL);
 phase := 12;
 INSERT INTO private.uba_redvault_refunds(id,attempt_id,state,refund_type,idempotency_key,amount_kobo)
 VALUES(refund_id,attempt_id,'processing','merchandise_units','CLEANUP-REFUND',50000);
 phase := 13;
 INSERT INTO private.uba_redvault_refund_line_allocations(refund_id,application_id,order_item_id,unit_ordinal,net_amount_kobo)
 VALUES(refund_id,application_id,item_id,1,50000);
 phase := 7;
 UPDATE private.uba_redvault_refunds SET state='processed' WHERE id=refund_id;
 phase := 8;
 SELECT lifecycle.inventory_state INTO state FROM private.uba_redvault_refund_lifecycle lifecycle WHERE lifecycle.refund_id=refund_id;
 IF state IS DISTINCT FROM 'released' THEN RAISE EXCEPTION 'refund inventory state: %', state; END IF;
 phase := 14;
 IF (SELECT stock_quantity FROM public.product_offers WHERE id=offer_id) IS DISTINCT FROM offer_stock+1 THEN
   RAISE EXCEPTION 'refund must restore offer stock exactly once';
 END IF;
 phase := 15;
 IF (SELECT stock_quantity FROM public.products WHERE id=product_id) IS DISTINCT FROM parent_stock THEN
   RAISE EXCEPTION 'refund must not restore parent product stock';
 END IF;
 phase := 16;
 IF (SELECT fulfillment_data->>'fulfillmentQuantity' FROM public.order_items WHERE id=item_id) IS DISTINCT FROM '0' THEN
   RAISE EXCEPTION 'refund must remove refunded quantity from fulfillment';
 END IF;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('test.redvault_refund_failure_phase',phase::text,true);
END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '1' THEN RAISE EXCEPTION 'refund fixture phase 1 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '2' THEN RAISE EXCEPTION 'refund fixture phase 2 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '3' THEN RAISE EXCEPTION 'refund fixture phase 3 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '4' THEN RAISE EXCEPTION 'refund fixture phase 4 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '5' THEN RAISE EXCEPTION 'refund fixture phase 5 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '6' THEN RAISE EXCEPTION 'refund fixture phase 6 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '7' THEN RAISE EXCEPTION 'refund fixture phase 7 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '8' THEN RAISE EXCEPTION 'refund fixture phase 8 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '9' THEN RAISE EXCEPTION 'refund fixture phase 9 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '10' THEN RAISE EXCEPTION 'refund fixture phase 10 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '11' THEN RAISE EXCEPTION 'refund fixture phase 11 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '12' THEN RAISE EXCEPTION 'refund fixture phase 12 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '13' THEN RAISE EXCEPTION 'refund fixture phase 13 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '14' THEN RAISE EXCEPTION 'refund fixture phase 14 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '15' THEN RAISE EXCEPTION 'refund fixture phase 15 failed'; END IF; END $$;
DO $$ BEGIN IF current_setting('test.redvault_refund_failure_phase',true) = '16' THEN RAISE EXCEPTION 'refund fixture phase 16 failed'; END IF; END $$;
ROLLBACK;
