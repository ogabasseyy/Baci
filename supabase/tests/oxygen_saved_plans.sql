-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efac0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efac0000-0000-4000-8000-000000000021','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021');
UPDATE public.oxygen_workflows SET stage='reconciliation_required' WHERE id='efac0000-0000-4000-8000-000000000041';
DO $$ DECLARE state jsonb; variant jsonb; BEGIN
 state:=jsonb_build_object('bookingReference','efac0000-0000-4000-8000-000000000071','phone','private phone',
  'booking',jsonb_build_object('loan_reference','efac0000-0000-4000-8000-000000000071','status','BOOKED','product_amount',400000,'equity_percentage',25,'equity_amount',100000,'loan_amount',300000,'loan_tenure',3),
  'quotedCharges',1000,'schedule','[{"period":1,"dueDate":[2026,11,27],"amount":110000,"principal":100000,"interest":10000},{"period":2,"dueDate":[2026,12,27],"amount":110000,"principal":100000,"interest":10000},{"period":3,"dueDate":[2027,1,27],"amount":110000,"principal":100000,"interest":10000}]'::jsonb);
 INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efac0000-0000-4000-8000-000000000041',state);
 -- Duplicate terms with another booking must retain the first cached reference.
 variant:=jsonb_set(jsonb_set(state,'{bookingReference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,loan_reference}','"efac0000-0000-4000-8000-000000000072"');
 PERFORM oxygen_private.retain_saved_plan('efac0000-0000-4000-8000-000000000041',variant);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041');
 IF jsonb_array_length(result->'plans')<>1 OR result->>'selectedReference'<>'efac0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Cache did not reuse first reference'; END IF;
 IF result::text LIKE '%private phone%' THEN RAISE EXCEPTION 'Private state leaked'; END IF;
 PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071');
 BEGIN
  PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072');
  RAISE EXCEPTION 'Uncached ref accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM state FROM oxygen_private.saved_plans; RAISE EXCEPTION 'Direct cache read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Cross-customer read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071'); RAISE EXCEPTION 'Cross-customer selection accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE workflow_id='efac0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Selection created provider command'; END IF;
 IF (SELECT stage FROM public.oxygen_workflows WHERE id='efac0000-0000-4000-8000-000000000041')<>'reconciliation_required' THEN RAISE EXCEPTION 'Selection cleared hold'; END IF;
END $$;
UPDATE public.orders SET total=400001 WHERE id='efac0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041');
 IF jsonb_array_length(result->'plans')<>0 OR result->>'selectedReference' IS NOT NULL THEN RAISE EXCEPTION 'Stale amount cache accepted'; END IF;
 BEGIN PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071'); RAISE EXCEPTION 'Stale amount selected'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK;
