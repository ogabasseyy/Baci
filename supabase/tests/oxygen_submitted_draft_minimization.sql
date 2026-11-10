-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efaa0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaa0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaa0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000003','draft-merchant@example.test','Draft RLS fixture','oxygen-draft-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efaa0000-0000-4000-8000-000000000021','efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000001','Test','Customer','draft-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efaa0000-0000-4000-8000-000000000031','efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000021','OXYGEN-DRAFT-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000031','efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000021');

-- A normal draft has a separate encrypted address copy. Keep both copies while
-- the provider request is executing or indeterminate.
INSERT INTO public.oxygen_form_drafts(workflow_id,user_id,ciphertext,residential_ciphertext,residential_version,mutation_id)
VALUES ('efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000001',repeat('full-fixture',4),repeat('address-fixture',4),1,'efaa0000-0000-4000-8000-000000000051');
-- A retained address ciphertext must have its encryption revision.
DO $$ BEGIN
 BEGIN
  UPDATE public.oxygen_form_drafts SET residential_version=NULL,version=version+1 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
  RAISE EXCEPTION 'Ciphertext without version accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efaa0000-0000-4000-8000-000000000061','efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000062',0,'web','{"action":"start_application"}','executing');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NOT NULL AND residential_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Draft absent before confirmation'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='efaa0000-0000-4000-8000-000000000061';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Indeterminate request erased the identity draft'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='executing' WHERE id='efaa0000-0000-4000-8000-000000000061';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ('efaa0000-0000-4000-8000-000000000041','{"applicationReference":"efaa0000-0000-4000-8000-000000000071"}');
-- The trusted minimizer also works if the workflow was already advanced.
SAVEPOINT advanced_stage;
UPDATE public.oxygen_workflows SET stage='kyc_required' WHERE id='efaa0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='efaa0000-0000-4000-8000-000000000061';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NULL AND residential_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Advanced stage blocked identity minimization'; END IF;
END $$;
ROLLBACK TO SAVEPOINT advanced_stage;
-- Legacy rows have no separately encrypted residential copy. Preserve those
-- until a safe decrypt/re-encrypt migration or the existing expiry/DONE purge.
SAVEPOINT legacy_draft;
UPDATE public.oxygen_form_drafts SET residential_ciphertext=NULL,residential_version=NULL,version=version+1 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='efaa0000-0000-4000-8000-000000000061';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NOT NULL AND residential_ciphertext IS NULL) THEN RAISE EXCEPTION 'Legacy residential recovery was destroyed'; END IF;
END $$;
ROLLBACK TO SAVEPOINT legacy_draft;
SAVEPOINT before_success;
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='efaa0000-0000-4000-8000-000000000061';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NULL AND residential_ciphertext IS NOT NULL AND residential_version=1 AND version=2) THEN RAISE EXCEPTION 'Confirmed creation did not minimize the draft'; END IF;
END $$;
ROLLBACK TO -- The trusted minimizer also works if the workflow was already advanced.
SAVEPOINT advanced_stage;
UPDATE public.oxygen_workflows SET stage='kyc_required' WHERE id='efaa0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='efaa0000-0000-4000-8000-000000000061';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NULL AND residential_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'Advanced stage blocked identity minimization'; END IF;
END $$;
ROLLBACK TO SAVEPOINT advanced_stage;
SAVEPOINT before_success;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE ciphertext IS NOT NULL AND version=1) THEN RAISE EXCEPTION 'Rollback lost the draft'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='succeeded' WHERE id='efaa0000-0000-4000-8000-000000000061';
UPDATE public.oxygen_workflows SET stage='kyc_required' WHERE id='efaa0000-0000-4000-8000-000000000041';
-- A stale writer must fail after the workflow has progressed, even if it held
-- an old client-side stage snapshot.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN
  UPDATE public.oxygen_form_drafts SET ciphertext=repeat('old-full-fixture',4),version=version+1 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
  IF FOUND THEN RAISE EXCEPTION 'Stale writer restored identity'; END IF;
 EXCEPTION WHEN serialization_failure OR insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=state||'{"kyc":{"address_status":"DONE"}}'::jsonb WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Completed address did not purge residual draft'; END IF;
END $$;
ROLLBACK;
