-- Run against a disposable database after all migrations; rolls back fixtures.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('f1ab0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pilot-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('f1ab0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pilot-other@example.test','test',now(),now(),now(),'{}','{}'),
 ('f1ab0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pilot-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','f1ab0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000003','pilot-merchant@example.test','Pilot test','oxygen-pilot-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES
 ('f1ab0000-0000-4000-8000-000000000021','f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000001','Pilot','One','pilot-owner@example.test'),
 ('f1ab0000-0000-4000-8000-000000000022','f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000002','Other','Customer','pilot-other@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES
 ('f1ab0000-0000-4000-8000-000000000031','f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000021','OXYGEN-PILOT-ONE',400000,'NGN','unpaid','oxygen'),
 ('f1ab0000-0000-4000-8000-000000000032','f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000022','OXYGEN-PILOT-TWO',400000,'NGN','unpaid','oxygen'),
 ('f1ab0000-0000-4000-8000-000000000033','f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000022','OXYGEN-PILOT-THREE',400000,'NGN','unpaid','oxygen');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES ('production-pilot-fixture','f1ab0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,environment,enabled)
VALUES ('f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000003','production-pilot-fixture','production',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1ab0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000032','web');
  RAISE EXCEPTION 'Unapproved production customer started a workflow';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.production_admission_policy(merchant_id,mode)
VALUES ('f1ab0000-0000-4000-8000-000000000011','pilot');
INSERT INTO oxygen_private.production_pilot_customers(merchant_id,user_id)
VALUES ('f1ab0000-0000-4000-8000-000000000011','f1ab0000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1ab0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  INSERT INTO oxygen_private.production_pilot_customers(merchant_id,user_id) VALUES ('f1ab0000-0000-4000-8000-000000000011',auth.uid());
  RAISE EXCEPTION 'Customer modified the pilot list';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000032','web');
  RAISE EXCEPTION 'Unapproved customer bypassed pilot restriction';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','f1ab0000-0000-4000-8000-000000000001',true);
SELECT public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000031','web');
RESET ROLE;
SELECT set_config('oxygen_test.original_workflow',id::text,true) FROM public.oxygen_workflows WHERE order_id='f1ab0000-0000-4000-8000-000000000031';
DELETE FROM oxygen_private.production_pilot_customers WHERE merchant_id='f1ab0000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
-- Existing applications must remain recoverable after pilot access is revoked.
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000031','web');
 IF result->>'id' IS DISTINCT FROM current_setting('oxygen_test.original_workflow') THEN RAISE EXCEPTION 'Resume did not return the original workflow'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.production_admission_policy SET mode='open' WHERE merchant_id='f1ab0000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1ab0000-0000-4000-8000-000000000002',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000032','web');
 IF result->>'order_id' IS DISTINCT FROM 'f1ab0000-0000-4000-8000-000000000032' THEN RAISE EXCEPTION 'Open rollout returned a different order'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.oxygen_workflows WHERE order_id='f1ab0000-0000-4000-8000-000000000032') THEN RAISE EXCEPTION 'Open rollout failed to persist the workflow'; END IF;
END $$;
DELETE FROM oxygen_private.production_admission_policy WHERE merchant_id='f1ab0000-0000-4000-8000-000000000011';
UPDATE oxygen_private.runtime_bindings SET environment='staging' WHERE merchant_id='f1ab0000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_start_workflow('f1ab0000-0000-4000-8000-000000000033','web');
 IF result->>'environment' IS DISTINCT FROM 'staging' OR result->>'id' IS NULL THEN RAISE EXCEPTION 'Staging admission did not create a staging workflow'; END IF;
END $$;
ROLLBACK;
