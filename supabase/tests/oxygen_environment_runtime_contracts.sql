-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efab0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','env-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efab0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','env-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efab0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','env-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000003','env-merchant@example.test','Draft RLS fixture','oxygen-environment-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efab0000-0000-4000-8000-000000000021','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000001','Test','Customer','env-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efab0000-0000-4000-8000-000000000031','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000021','OXYGEN-ENV-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('environment-fixture','efab0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,environment,enabled)
VALUES ('efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000003','environment-fixture','production',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_start_workflow('efab0000-0000-4000-8000-000000000031','web');
 IF result->>'environment'<>'production' THEN RAISE EXCEPTION 'Workflow did not use binding environment'; END IF;
END $$;
RESET ROLE;
-- A binding changed after workflow creation must not make the old workflow executable.
UPDATE oxygen_private.runtime_bindings SET environment='staging' WHERE partner_reference='environment-fixture';
SET LOCAL ROLE authenticated;
DO $$ DECLARE id uuid; snapshot jsonb; BEGIN
 SELECT w.id INTO id FROM public.oxygen_workflows w WHERE w.order_id='efab0000-0000-4000-8000-000000000031';
 snapshot:=public.oxygen_runtime('status',id,'{}');
 IF (snapshot->>'executionEnabled')::boolean THEN RAISE EXCEPTION 'Environment mismatch reported enabled'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('enqueue',id,jsonb_build_object('version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000051','command',jsonb_build_object('action','refresh_kyc')));
  RAISE EXCEPTION 'Environment mismatch accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.runtime_bindings SET environment='production' WHERE partner_reference='environment-fixture';
INSERT INTO oxygen_private.general_activations(workflow_id,merchant_id,customer_id,order_id,environment,application_reference,booking_reference,amount,status)
SELECT id,merchant_id,customer_id,order_id,environment,'efab0000-0000-4000-8000-000000000061','efab0000-0000-4000-8000-000000000062',400000,'executing'
FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
DO $$ DECLARE workflow uuid; op text; BEGIN
 SELECT id INTO workflow FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
 PERFORM public.oxygen_runtime('status',workflow,'{}');
 FOREACH op IN ARRAY ARRAY['enqueue','reconcile'] LOOP
  PERFORM set_config('request.jwt.claim.sub', CASE WHEN op='reconcile'
   THEN 'efab0000-0000-4000-8000-000000000003' ELSE 'efab0000-0000-4000-8000-000000000001' END,true);
  BEGIN
   PERFORM public.oxygen_runtime(op,workflow,jsonb_build_object('version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000051','command',jsonb_build_object('action','refresh_kyc')));
   RAISE EXCEPTION 'Activation executing did not fence %',op;
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000001',true);
UPDATE oxygen_private.general_activations SET status='indeterminate';
UPDATE public.oxygen_workflows SET stage='payment_required' WHERE order_id='efab0000-0000-4000-8000-000000000031';
INSERT INTO oxygen_private.provider_states(workflow_id,state)
SELECT id,jsonb_build_object('bookingReference','efab0000-0000-4000-8000-000000000062',
 'booking',jsonb_build_object('status','APPROVED'),'paymentComplete',false,'setupComplete',false)
FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
DO $$ DECLARE workflow uuid; BEGIN
 SELECT id INTO workflow FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
 PERFORM public.oxygen_runtime('status',workflow,'{}');
 BEGIN
  PERFORM public.oxygen_runtime('enqueue',workflow,jsonb_build_object('version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000051','command',jsonb_build_object('action','refresh_kyc')));
  RAISE EXCEPTION 'Indeterminate activation did not fence enqueue';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_payment_recovery('enqueue',workflow,jsonb_build_object('workflowId',workflow,'reference','efab0000-0000-4000-8000-000000000062','version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000052','action','resend_upfront'));
  RAISE EXCEPTION 'Indeterminate activation did not fence resend';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 PERFORM public.oxygen_payment_recovery('enqueue',workflow,jsonb_build_object('workflowId',workflow,'reference','efab0000-0000-4000-8000-000000000062','version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000053','action','check_status'));
END $$;
RESET ROLE;
ROLLBACK;
