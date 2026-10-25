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

-- Cache-only corruption/conflicts must never roll back provider result persistence.
DO $$ DECLARE original jsonb; variant jsonb; BEGIN
 SELECT state INTO original FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
 -- A reused booking reference with different terms collides with the secondary unique index.
 variant:=jsonb_set(original,'{booking,equity_percentage}','35');
 UPDATE oxygen_private.provider_states SET state=variant WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
 IF (SELECT state->'booking'->>'equity_percentage' FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041')<>'35' THEN RAISE EXCEPTION 'Provider result not saved'; END IF;
 variant:=jsonb_set(original,'{booking,loan_tenure}','"invalid"');
 UPDATE oxygen_private.provider_states SET state=variant WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
 variant:=original #- '{booking,product_amount}';
 UPDATE oxygen_private.provider_states SET state=variant WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
 IF (SELECT count(*) FROM oxygen_private.saved_plans WHERE workflow_id='efac0000-0000-4000-8000-000000000041')<>1 THEN RAISE EXCEPTION 'Invalid cache rows retained'; END IF;
 UPDATE oxygen_private.provider_states SET state=original WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
END $$;
ROLLBACK;
