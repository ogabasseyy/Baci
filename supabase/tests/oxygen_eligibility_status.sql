-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
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
 '{"commandId":"efab0000-0000-4000-8000-000000000051","outcome":"succeeded","stage":"eligibility_required","state":{"eligibilityStatus":"failed","eligibilityFailureReason":"financial_details_mismatch","validated":true}}');
DO $$ BEGIN
 IF public.oxygen_runtime('worker_status','efab0000-0000-4000-8000-000000000041','{"includeEligibilityFailureReason":true}')->'state' ? 'eligibilityFailureReason' THEN
  RAISE EXCEPTION 'Legacy worker state exposed the new reason';
 END IF;
END $$;
DO $$
DECLARE invalid jsonb;
BEGIN
 FOREACH invalid IN ARRAY ARRAY['{"eligibilityStatus":"approved"}'::jsonb,'{"eligibilityStatus":null}'::jsonb,'{"eligibilityStatus":3}'::jsonb,'{"eligibilityStatus":"failed","unexpected":"x"}'::jsonb,'{"eligibilityStatus":"failed","eligibilityFailureReason":"private provider text"}'::jsonb,'{"eligibilityStatus":"failed","eligibilityFailureReason":null}'::jsonb,'{"eligibilityStatus":"pending","eligibilityFailureReason":"financial_details_mismatch"}'::jsonb,'{"eligibilityStatus":"failed","eligible":false,"eligibilityFailureReason":"financial_details_mismatch"}'::jsonb] LOOP
  BEGIN
   PERFORM public.oxygen_runtime('finish','efab0000-0000-4000-8000-000000000051',jsonb_build_object('commandId','efab0000-0000-4000-8000-000000000051','outcome','succeeded','stage','eligibility_required','state',invalid));
   RAISE EXCEPTION 'Invalid provider status accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_runtime('status','efab0000-0000-4000-8000-000000000041','{"includeEligibilityFailureReason":true}');
  RAISE EXCEPTION 'Stranger could read eligibility reason';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efab0000-0000-4000-8000-000000000051','{"commandId":"efab0000-0000-4000-8000-000000000051","outcome":"succeeded","stage":"eligibility_required","state":{"eligibilityStatus":"failed"}}');
  RAISE EXCEPTION 'Unbound caller accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efab0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF public.oxygen_runtime('status','efab0000-0000-4000-8000-000000000041')->'state' ? 'eligibilityFailureReason' THEN
  RAISE EXCEPTION 'Legacy customer state exposed the new reason';
 END IF;
 IF public.oxygen_runtime('status','efab0000-0000-4000-8000-000000000041','{"includeEligibilityFailureReason":true}')->'state'->>'eligibilityFailureReason' IS DISTINCT FROM 'financial_details_mismatch' THEN
  RAISE EXCEPTION 'Owner could not read saved eligibility reason';
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT state->>'eligibilityStatus' FROM oxygen_private.provider_states WHERE workflow_id='efab0000-0000-4000-8000-000000000041') IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'Failure status not saved'; END IF;
 IF (SELECT state ? 'eligibilityFailureReason' FROM oxygen_private.provider_states WHERE workflow_id='efab0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Failure reason leaked into legacy state'; END IF;
 IF (SELECT eligibility_failure_reason FROM oxygen_private.provider_states WHERE workflow_id='efab0000-0000-4000-8000-000000000041') IS DISTINCT FROM 'financial_details_mismatch' THEN RAISE EXCEPTION 'Failure reason not saved'; END IF;
END $$;
ROLLBACK;
