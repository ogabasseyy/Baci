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
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efaa0000-0000-4000-8000-000000000031','efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000021','OXYGEN-DRAFT-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000031','efaa0000-0000-4000-8000-000000000011','efaa0000-0000-4000-8000-000000000021');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000001',true);
INSERT INTO public.oxygen_form_drafts(workflow_id,user_id,ciphertext,mutation_id)
VALUES ('efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000001',repeat('encrypted-fixture',4),'efaa0000-0000-4000-8000-000000000051');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') <> 1 THEN RAISE EXCEPTION 'Owner must read draft'; END IF;
 UPDATE public.oxygen_form_drafts SET version=2 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041' AND version=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner must update draft'; END IF;
 BEGIN
  UPDATE public.oxygen_form_drafts SET version=4 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
  RAISE EXCEPTION 'Revision skip accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Stranger read draft'; END IF;
 UPDATE public.oxygen_form_drafts SET version=3 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
 IF FOUND THEN RAISE EXCEPTION 'Stranger updated draft'; END IF;
 DELETE FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
 IF FOUND THEN RAISE EXCEPTION 'Stranger deleted draft'; END IF;
 BEGIN
  INSERT INTO public.oxygen_form_drafts(workflow_id,user_id,ciphertext,mutation_id)
  VALUES ('efaa0000-0000-4000-8000-000000000041','efaa0000-0000-4000-8000-000000000002',repeat('encrypted-fixture',4),'efaa0000-0000-4000-8000-000000000052');
  RAISE EXCEPTION 'Stranger inserted owner workflow draft';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Merchant ownership does not grant access to the customer's identity draft.
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Merchant read customer draft'; END IF;
END $$;
RESET ROLE;
UPDATE public.oxygen_workflows SET stage='booked' WHERE id='efaa0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 UPDATE public.oxygen_form_drafts SET version=3 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
 IF FOUND THEN RAISE EXCEPTION 'Progressed application draft changed'; END IF;
 DELETE FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner cannot discard draft'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM workflow_id FROM public.oxygen_form_drafts;
  RAISE EXCEPTION 'Anonymous read granted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
