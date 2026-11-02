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
UPDATE public.orders SET payment_method='oxygen' WHERE id='efac0000-0000-4000-8000-000000000031';
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('saved-plan-test-partner','efac0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','saved-plan-test-partner',true);
UPDATE public.oxygen_workflows SET stage='approval_required' WHERE id='efac0000-0000-4000-8000-000000000041';
DO $$ DECLARE state jsonb; variant jsonb; BEGIN
 state:=jsonb_build_object('bookingReference','efac0000-0000-4000-8000-000000000071','phone','private phone',
  'booking',jsonb_build_object('loan_reference','efac0000-0000-4000-8000-000000000071','status','BOOKED','product_amount',400000,'equity_percentage',25,'equity_amount',100000,'loan_amount',300000,'loan_tenure',3),
  'quotedCharges',1000,'schedule','[{"period":1,"dueDate":[2026,11,27],"amount":110000,"principal":100000,"interest":10000},{"period":2,"dueDate":[2026,12,27],"amount":110000,"principal":100000,"interest":10000},{"period":3,"dueDate":[2027,1,27],"amount":110000,"principal":100000,"interest":10000}]'::jsonb);
 INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efac0000-0000-4000-8000-000000000041',state);
 -- Duplicate terms with another booking must retain the first cached reference.
 variant:=jsonb_set(jsonb_set(state,'{bookingReference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,loan_reference}','"efac0000-0000-4000-8000-000000000072"');
 PERFORM oxygen_private.retain_saved_plan('efac0000-0000-4000-8000-000000000041',variant);
END $$;

-- Add a different cached plan B and make it the current canonical booking.
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 SELECT state INTO a FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
 b:=jsonb_set(jsonb_set(jsonb_set(a,'{bookingReference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,loan_reference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,equity_percentage}','35');
 INSERT INTO oxygen_private.saved_plans(workflow_id,booking_reference,product_amount,equity_percentage,tenure,state)
 VALUES('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',400000,35,3,b-'phone');
 UPDATE oxygen_private.provider_states SET state=b WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071',0); RAISE EXCEPTION 'Cross-owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071');
 result:=public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071',0);
 IF result->>'bookingReference'<>'efac0000-0000-4000-8000-000000000071' OR (result->>'version')::int<>1 THEN RAISE EXCEPTION 'Acceptance response incorrect'; END IF;
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',0); RAISE EXCEPTION 'Stale version accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT state->>'bookingReference' FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041')<>'efac0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Canonical selection not updated'; END IF;
 IF (SELECT state->>'phone' FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041')<>'private phone' THEN RAISE EXCEPTION 'Private context lost'; END IF;
 IF EXISTS (SELECT 1 FROM oxygen_private.commands WHERE workflow_id='efac0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Provider command created'; END IF;
END $$;
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{activityToken}','"otp-token"') WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',1); RAISE EXCEPTION 'OTP fence bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=state-'activityToken' WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000081',1,'web','{"action":"book"}'::jsonb,'indeterminate');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',1); RAISE EXCEPTION 'Pending command fence bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.commands WHERE idempotency_key='efac0000-0000-4000-8000-000000000081';
UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id='efac0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',1); RAISE EXCEPTION 'Payment stage fence bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
