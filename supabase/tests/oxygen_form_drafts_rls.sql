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

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000001',true);
SELECT public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041',0,'efaa0000-0000-4000-8000-000000000051',repeat('encrypted-fixture',4),repeat('address-fixture',4),now()+interval '1 day');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') <> 1 THEN RAISE EXCEPTION 'Owner must read draft'; END IF;
 PERFORM public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041',1,'efaa0000-0000-4000-8000-000000000052',repeat('encrypted-fixture',4),repeat('address-fixture',4),now()+interval '1 day');
 BEGIN
  PERFORM public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041',1,'efaa0000-0000-4000-8000-000000000053',repeat('encrypted-fixture',4),repeat('address-fixture',4),now()+interval '1 day');
  RAISE EXCEPTION 'Stale version accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  UPDATE public.oxygen_form_drafts SET version=3 WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
  RAISE EXCEPTION 'Direct write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','efaa0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Stranger read draft'; END IF;
 BEGIN
  PERFORM public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041',1,'efaa0000-0000-4000-8000-000000000052',repeat('encrypted-fixture',4),repeat('address-fixture',4),now()+interval '1 day');
  RAISE EXCEPTION 'Stranger updated draft';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
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
 BEGIN
  PERFORM public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041',2,'efaa0000-0000-4000-8000-000000000052',repeat('encrypted-fixture',4),repeat('address-fixture',4),now()+interval '1 day');
  RAISE EXCEPTION 'Progressed application draft changed';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 DELETE FROM public.oxygen_form_drafts WHERE workflow_id='efaa0000-0000-4000-8000-000000000041';
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner cannot discard draft'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
-- Distinct SQLSTATEs identify the failing privilege check without leaking data.
\set VERBOSITY verbose
DO $$ BEGIN
 IF has_function_privilege('anon','public.oxygen_save_form_draft(uuid,integer,uuid,text,text,timestamp with time zone)','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous draft save privilege granted' USING ERRCODE='P1001';
 END IF;
END $$;
DO $$ BEGIN
 IF has_table_privilege('anon','public.oxygen_form_drafts','SELECT') THEN
  RAISE EXCEPTION 'Anonymous draft read privilege granted' USING ERRCODE='P1002';
 END IF;
END $$;
-- Exercise the revoked RPC directly; capture the actual server SQLSTATE rather
-- than running the denied invocation inside a PL/pgSQL exception handler.
SAVEPOINT oxygen_anon_draft_call;
\set ON_ERROR_STOP off
SELECT public.oxygen_save_form_draft('efaa0000-0000-4000-8000-000000000041'::uuid,0::integer,'efaa0000-0000-4000-8000-000000000055'::uuid,repeat('encrypted-fixture',4)::text,repeat('address-fixture',4)::text,(now()+interval '1 day')::timestamptz);
\set oxygen_anon_draft_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT oxygen_anon_draft_call;
SELECT :'oxygen_anon_draft_state' = '42501' AS oxygen_anon_draft_denied \gset
\if :oxygen_anon_draft_denied
 \echo OXYGEN_ANON_DRAFT_DENIAL_OK
\else
 DO $$ BEGIN RAISE EXCEPTION 'Anonymous draft save did not return insufficient privilege' USING ERRCODE='P1003'; END $$;
\endif
DO $$ BEGIN
 BEGIN
  PERFORM workflow_id FROM public.oxygen_form_drafts;
  RAISE EXCEPTION 'Anonymous draft read executed' USING ERRCODE='P1004';
 EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN RAISE EXCEPTION 'Anonymous draft read unexpected error' USING ERRCODE='P1004'; END;
END $$;
ROLLBACK;
