-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efae0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efae0000-0000-4000-8000-000000000021','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','response-evidence-fixture',true);
UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"applicationReference":"efae0000-0000-4000-8000-000000000071"}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"refresh_eligibility"}','queued',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('claim','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081"}');
 IF r IS NULL THEN RAISE EXCEPTION 'Fixture claim failed'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"plan_required","state":{"offers":[{"loanAmount":-1,"tenure":1}]}}');
  RAISE EXCEPTION 'Invalid offer accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"plan_required","state":{"offers":[{"loanAmount":68000,"tenure":1},{"loanAmount":189000,"tenure":1}]}}');
  RAISE EXCEPTION 'Duplicate tenure accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"plan_required","state":{"maxTenure":2,"offers":[{"loanAmount":189000,"tenure":3}]}}');
  RAISE EXCEPTION 'Offer longer than maximum tenure accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"plan_required","state":{"maxTenure":3,"offers":[{"loanAmount":68000.001,"tenure":1}]}}');
  RAISE EXCEPTION 'Offer with excess precision accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"plan_required","state":{"applicationReference":"efae0000-0000-4000-8000-000000000071","offers":[{"loanAmount":68000,"tenure":1},{"loanAmount":189000,"tenure":3}]}}');
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_runtime('status','efae0000-0000-4000-8000-000000000041');
  RAISE EXCEPTION 'Foreign customer accessed offers';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('status','efae0000-0000-4000-8000-000000000041');
 IF r->'state'->'offers'->1->>'loanAmount' <> '189000' THEN RAISE EXCEPTION 'Owner snapshot missing offers'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT state->'offers'->1->>'loanAmount' FROM oxygen_private.provider_states WHERE workflow_id='efae0000-0000-4000-8000-000000000041') <> '189000' THEN RAISE EXCEPTION 'Offers not saved'; END IF;
END $$;
ROLLBACK;
