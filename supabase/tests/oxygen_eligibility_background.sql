-- Transactional coverage for background eligibility and its worker binding.
BEGIN;
DO $test$
DECLARE
 access_role text;
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='oxygen_private.provider_states'::regclass) THEN
  RAISE EXCEPTION 'Provider state RLS is disabled';
 END IF;
 FOREACH access_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_column_privilege(access_role,'oxygen_private.provider_states','eligibility_progress','SELECT,INSERT,UPDATE') THEN
   RAISE EXCEPTION 'Role % has direct eligibility progress access',access_role;
  END IF;
 END LOOP;
END $test$;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efab0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eligibility-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efab0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eligibility-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efab0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eligibility-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000003','eligibility-merchant@example.test','Eligibility fixture','oxygen-eligibility-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efab0000-0000-4000-8000-000000000021','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000001','Test','Customer','eligibility-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efab0000-0000-4000-8000-000000000031','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efab0000-0000-4000-8000-000000000041','efab0000-0000-4000-8000-000000000031','efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('eligibility-test-partner','efab0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES ('efab0000-0000-4000-8000-000000000011','efab0000-0000-4000-8000-000000000003','eligibility-test-partner',true);
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efab0000-0000-4000-8000-000000000051','efab0000-0000-4000-8000-000000000041','efab0000-0000-4000-8000-000000000061',0,'web','{"action":"refresh_eligibility"}','executing');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_runtime('finish','efab0000-0000-4000-8000-000000000051',
 '{"commandId":"efab0000-0000-4000-8000-000000000051","outcome":"succeeded","stage":"eligibility_required","state":{"applicationReference":"efab0000-0000-4000-8000-000000000071","eligibilityStatus":"pending","validated":true,"kyc":{"phone_status":"DONE","bvn_status":"DONE","selfie_status":"DONE","nin_status":"DONE","bank_status":"DONE","address_status":"DONE"}}}');
DO $$ BEGIN
 IF public.oxygen_eligibility_background('claim_check','eligibility-test-partner','staging') IS NOT NULL THEN
  RAISE EXCEPTION 'First check ignored the scheduled delay';
 END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.eligibility_jobs SET next_check_at=now()
 WHERE workflow_id='efab0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_eligibility_background('claim_check','eligibility-test-partner','staging');
  RAISE EXCEPTION 'Unbound customer could claim a worker check';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000003',true);
DO $test$
DECLARE item jsonb; command_id uuid; observed jsonb;
BEGIN
 item:=public.oxygen_eligibility_background('claim_check','eligibility-test-partner','staging');
 command_id:=(item->>'commandId')::uuid;
 IF command_id IS NULL THEN RAISE EXCEPTION 'Bound worker did not claim due check'; END IF;
 IF public.oxygen_eligibility_background('claim_check','eligibility-test-partner','staging') IS NOT NULL THEN
  RAISE EXCEPTION 'Duplicate check claimed';
 END IF;
 observed:=public.oxygen_runtime('claim',command_id,jsonb_build_object('commandId',command_id));
 IF observed->'command'->>'action' IS DISTINCT FROM 'refresh_eligibility' THEN
  RAISE EXCEPTION 'Unexpected action claimed';
 END IF;
 PERFORM public.oxygen_runtime('finish',command_id,jsonb_build_object(
   'commandId',command_id,'outcome','succeeded','stage','plan_required',
   'state', '{"applicationReference":"efab0000-0000-4000-8000-000000000071","validated":true,"eligibilityStatus":"completed","eligible":true,"eligibleAmount":192000,"minimumAmount":69000,"maxTenure":3,"offers":[{"tenure":3,"loanAmount":192000}]}'::jsonb
 ));
 IF public.oxygen_eligibility_background('claim_check','eligibility-test-partner','staging') IS NOT NULL THEN
  RAISE EXCEPTION 'Completed eligibility was retried';
 END IF;
END $test$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM oxygen_private.eligibility_jobs
   WHERE workflow_id='efab0000-0000-4000-8000-000000000041' AND notification_status='ready'
   AND attempts=1 AND next_check_at=now()+interval '10 minutes') THEN
   RAISE EXCEPTION 'No eligible notification or wrong backoff after confirmed offers';
 END IF;
END $$;
ROLLBACK;
