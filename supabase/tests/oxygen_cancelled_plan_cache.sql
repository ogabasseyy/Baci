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
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('saved-plan-test-partner','efac0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','saved-plan-test-partner',true);
UPDATE public.oxygen_workflows SET stage='approval_required' WHERE id='efac0000-0000-4000-8000-000000000041';
DO $$ DECLARE state jsonb; variant jsonb; BEGIN
 state:=jsonb_build_object('bookingReference','efac0000-0000-4000-8000-000000000071','phone','private phone','eligibleAmount',400000,'minimumAmount',10000,'maxTenure',3,'offers','[{"tenure":3,"loanAmount":400000}]'::jsonb,
  'booking',jsonb_build_object('loan_reference','efac0000-0000-4000-8000-000000000071','status','BOOKED','product_amount',400000,'equity_percentage',25,'equity_amount',100000,'loan_amount',300000,'loan_tenure',3),
  'quotedCharges',1000,'schedule','[{"period":1,"dueDate":[2026,11,27],"amount":110000,"principal":100000,"interest":10000},{"period":2,"dueDate":[2026,12,27],"amount":110000,"principal":100000,"interest":10000},{"period":3,"dueDate":[2027,1,27],"amount":110000,"principal":100000,"interest":10000}]'::jsonb);
 INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efac0000-0000-4000-8000-000000000041',state);
 -- Duplicate terms with another booking must retain the first cached reference.
 variant:=jsonb_set(jsonb_set(state,'{bookingReference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,loan_reference}','"efac0000-0000-4000-8000-000000000072"');
 PERFORM oxygen_private.retain_saved_plan('efac0000-0000-4000-8000-000000000041',variant);
END $$;

CREATE TEMP TABLE cancelled_test_state AS SELECT state FROM oxygen_private.provider_states WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.plan_selections(workflow_id,booking_reference) VALUES('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efac0000-0000-4000-8000-000000000091','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000081',0,'web','{"action":"cancel_booking"}','queued');
SELECT oxygen_private.claim_command('efac0000-0000-4000-8000-000000000091');
-- Indeterminate cancellation retains the cache and selection.
SELECT oxygen_private.record_command('efac0000-0000-4000-8000-000000000091','indeterminate','reconciliation_required');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.saved_plans WHERE booking_reference='efac0000-0000-4000-8000-000000000071') OR NOT EXISTS(SELECT 1 FROM oxygen_private.plan_selections WHERE booking_reference='efac0000-0000-4000-8000-000000000071') THEN RAISE EXCEPTION 'Indeterminate cancellation invalidated'; END IF;
END $$;
DELETE FROM oxygen_private.history WHERE command_id='efac0000-0000-4000-8000-000000000091';
DELETE FROM oxygen_private.commands WHERE id='efac0000-0000-4000-8000-000000000091';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,completed_at)
VALUES('efac0000-0000-4000-8000-000000000093','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000083',0,'web','{"action":"trigger_approval_otp"}','succeeded',now());
UPDATE public.oxygen_workflows SET stage='approval_required',version=1 WHERE id='efac0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071',1); RAISE EXCEPTION 'Approval fence bypassed before cancellation'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efac0000-0000-4000-8000-000000000092','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000082',1,'web','{"action":"cancel_booking"}','queued');
SELECT oxygen_private.claim_command('efac0000-0000-4000-8000-000000000092');
UPDATE oxygen_private.provider_states SET state=state-ARRAY['bookingReference','booking','schedule','quotedCharges'] WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
SELECT oxygen_private.record_command('efac0000-0000-4000-8000-000000000092','succeeded','plan_required');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM oxygen_private.saved_plans WHERE booking_reference='efac0000-0000-4000-8000-000000000071') THEN RAISE EXCEPTION 'Cancelled booking remains cached'; END IF;
 IF EXISTS(SELECT 1 FROM oxygen_private.plan_selections WHERE booking_reference='efac0000-0000-4000-8000-000000000071') THEN RAISE EXCEPTION 'Cancelled booking remains selected'; END IF;
END $$;
-- A stale replay must not resurrect A, while a different confirmed plan B remains usable.
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 SELECT state INTO a FROM cancelled_test_state;
 PERFORM oxygen_private.retain_saved_plan('efac0000-0000-4000-8000-000000000041',a);
 IF EXISTS(SELECT 1 FROM oxygen_private.saved_plans WHERE booking_reference='efac0000-0000-4000-8000-000000000071') THEN RAISE EXCEPTION 'Cancelled snapshot resurrected'; END IF;
 b:=jsonb_set(jsonb_set(jsonb_set(a,'{bookingReference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,loan_reference}','"efac0000-0000-4000-8000-000000000072"'),'{booking,equity_percentage}','25');
 UPDATE oxygen_private.provider_states SET state=b WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
END $$;
UPDATE public.oxygen_workflows SET stage='approval_required',version=2 WHERE id='efac0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041');
 IF jsonb_array_length(result->'plans')<>1 OR result->>'selectedReference'<>'efac0000-0000-4000-8000-000000000072' THEN RAISE EXCEPTION 'Cancelled plan listed or new plan missing'; END IF;
 BEGIN PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071'); RAISE EXCEPTION 'Cancelled plan selectable'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071',2); RAISE EXCEPTION 'Cancelled plan accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 result:=public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',2);
 IF result->>'bookingReference' IS DISTINCT FROM 'efac0000-0000-4000-8000-000000000072' THEN RAISE EXCEPTION 'Replacement plan not accepted'; END IF;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,completed_at)
VALUES('efac0000-0000-4000-8000-000000000094','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000084',2,'web','{"action":"trigger_approval_otp"}','succeeded',now());
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072',2); RAISE EXCEPTION 'New approval fence bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
