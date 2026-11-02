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
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efab0000-0000-4000-8000-000000000031','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000021','OXYGEN-ENV-RLS',400000,'NGN','unpaid');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('environment-fixture','efab0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,environment,enabled)
VALUES ('efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000003','environment-fixture','production',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_start_workflow('efab0000-0000-4000-8000-000000000031','web'); RAISE EXCEPTION 'Wrong payment method created workflow'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.orders SET payment_method='oxygen' WHERE id='efab0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT public.oxygen_start_workflow('efab0000-0000-4000-8000-000000000031','web');
RESET ROLE;
UPDATE public.orders SET payment_method='paystack' WHERE id='efab0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
DO $$ DECLARE wid uuid; snap jsonb; BEGIN
 SELECT id INTO wid FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
 snap:=public.oxygen_runtime('status',wid,'{}');
 IF snap->>'executionEnabled'<>'false' THEN RAISE EXCEPTION 'Wrong method status enabled execution'; END IF;
 BEGIN PERFORM public.oxygen_runtime('enqueue',wid,jsonb_build_object('version',0,'idempotencyKey','efab0000-0000-4000-8000-000000000051','command',jsonb_build_object('action','refresh_kyc'))); RAISE EXCEPTION 'Wrong method enqueued'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command)
SELECT 'efab0000-0000-4000-8000-000000000052',id,'efab0000-0000-4000-8000-000000000053',0,'web','{"action":"refresh_kyc"}' FROM public.oxygen_workflows WHERE order_id='efab0000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('claim','efab0000-0000-4000-8000-000000000052','{"commandId":"efab0000-0000-4000-8000-000000000052"}'); RAISE EXCEPTION 'Wrong method claimed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
ROLLBACK;
