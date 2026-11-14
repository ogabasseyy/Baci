-- Run ONLY in a disposable PostgreSQL database. All fixture DDL rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), user_id uuid);
CREATE TABLE public.orders(id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), customer_id uuid REFERENCES public.customers(id), total numeric, currency text, payment_status text, cancelled_at timestamptz, customer_phone text DEFAULT '08012345678',order_number text DEFAULT 'test',shipping_address jsonb DEFAULT '{"address":"1 Test Street"}');
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_customer ON public.customers FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY self_order ON public.orders FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.user_id = auth.uid()));
GRANT SELECT ON public.orders,public.customers TO authenticated;
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency,payment_status,cancelled_at) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',400000,'NGN','unpaid',NULL),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',400000,'NGN','unpaid',NULL),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',400000,'NGN','unpaid',NULL);
-- Simulate permissive hosted defaults: the migration must revoke them.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO authenticated, anon;
\ir ../../../../supabase/migrations/20261020142857_oxygen_shared_workflow.sql
\ir ../../../../supabase/migrations/20261020150556_oxygen_provider_workflow_runtime.sql
\ir ../../../../supabase/migrations/20261020151230_oxygen_workflow_callbacks.sql
\ir ../../../../supabase/migrations/20261020210000_oxygen_recoverable_failures.sql
\ir ../../../../supabase/migrations/20261020220000_oxygen_callback_retry_keys.sql
\ir ../../../../supabase/migrations/20261023064641_oxygen_attempt_diagnostics.sql
INSERT INTO oxygen_private.partner_workers VALUES('test-partner','90000000-0000-4000-8000-000000000001'),('other-partner','90000000-0000-4000-8000-000000000002');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
 VALUES('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','test-partner',true),('10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','other-partner',true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='30000000-0000-4000-8000-000000000002';
SELECT public.oxygen_start_workflow('40000000-0000-4000-8000-000000000002');
RESET ROLE;
DO $$ BEGIN PERFORM set_config('test.foreign_workflow_id',(SELECT id::text FROM public.oxygen_workflows WHERE merchant_id='10000000-0000-4000-8000-000000000002'),true); END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='30000000-0000-4000-8000-000000000001';
SELECT public.oxygen_start_workflow('40000000-0000-4000-8000-000000000001');
DO $$ DECLARE w uuid; result jsonb; BEGIN
 SELECT id INTO w FROM public.oxygen_workflows;
 result:=public.oxygen_runtime('status',w);
 IF result->>'executionEnabled'<>'true' THEN RAISE EXCEPTION 'Missing readiness'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('claim',w);
  RAISE EXCEPTION 'Customer accessed worker';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_runtime('enqueue',w,'{"version":0,"idempotencyKey":"50000000-0000-4000-8000-000000000001","command":{"action":"start_application","otp":"123456"}}');
  RAISE EXCEPTION 'OTP persisted in command';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.oxygen_runtime('enqueue',w,'{"version":0,"idempotencyKey":"50000000-0000-4000-8000-000000000001","command":{"action":"start_application"}}');
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='90000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE cmd uuid; result jsonb; BEGIN
 BEGIN PERFORM public.oxygen_runtime('worker_status',current_setting('test.foreign_workflow_id')::uuid); RAISE EXCEPTION 'Cross-merchant worker access succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Ordinary worker credentials get no table reads, only scoped functions.
 BEGIN PERFORM 1 FROM oxygen_private.runtime_bindings; RAISE EXCEPTION 'Worker read private table';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Locate command through the fixture's known idempotency key using owner below.
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('test.command_id',(SELECT id::text FROM oxygen_private.commands LIMIT 1),true); END $$;
UPDATE public.orders SET payment_status='paid' WHERE id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE cmd uuid:=current_setting('test.command_id')::uuid; BEGIN
 BEGIN PERFORM public.oxygen_runtime('claim',cmd,jsonb_build_object('commandId',cmd)); RAISE EXCEPTION 'Paid order claim succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.orders SET payment_status='unpaid' WHERE id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE cmd uuid:=current_setting('test.command_id')::uuid; result jsonb; BEGIN
 result:=public.oxygen_runtime('claim',cmd,jsonb_build_object('commandId',cmd));
 IF result->'context'->>'partnerReference'<>'test-partner' THEN RAISE EXCEPTION 'Wrong provider binding'; END IF;
 IF public.oxygen_runtime('claim',cmd,jsonb_build_object('commandId',cmd)) IS NOT NULL THEN RAISE EXCEPTION 'Claim replay'; END IF;
 PERFORM public.oxygen_runtime('finish',cmd,jsonb_build_object('commandId',cmd,'outcome','succeeded','stage','eligibility_required','state',jsonb_build_object('applicationReference','60000000-0000-4000-8000-000000000001','newUserToken','private-token','phone','2348012345678')));
END $$;
SET LOCAL request.jwt.claim.sub='30000000-0000-4000-8000-000000000001';
DO $$ DECLARE w uuid; result jsonb; BEGIN
 SELECT id INTO w FROM public.oxygen_workflows;
 result:=public.oxygen_runtime('status',w);
 IF result->'state' ? 'newUserToken' OR result->'state' ? 'phone' THEN RAISE EXCEPTION 'Private state exposed'; END IF;
 BEGIN PERFORM public.oxygen_callback('pending','test-partner'); RAISE EXCEPTION 'Customer read callbacks';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='90000000-0000-4000-8000-000000000001';
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_callback('accept','test-partner','{"kind":"address","phoneNumber":"08012345678","action":"reconcile_kyc"}');
 IF result->>'result'<>'accepted' THEN RAISE EXCEPTION 'Callback lost'; END IF;
 result:=public.oxygen_callback('pending','test-partner');
 IF jsonb_array_length(result)<>1 OR jsonb_array_length(result->0->'workflowIds')<>1 THEN RAISE EXCEPTION 'Callback not correlated'; END IF;
 PERFORM public.oxygen_callback('accept','test-partner','{"kind":"transaction","deduplicationKey":"transaction:fixture","bookedLoanReference":"70000000-0000-4000-8000-000000000001"}');
 result:=public.oxygen_callback('accept','test-partner','{"kind":"transaction","deduplicationKey":"transaction:fixture","bookedLoanReference":"70000000-0000-4000-8000-000000000001"}');
 IF result->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Duplicate not detected'; END IF;
 BEGIN
  PERFORM public.oxygen_callback('accept','test-partner','{"kind":"transaction","deduplicationKey":"transaction:fixture","bookedLoanReference":"70000000-0000-4000-8000-000000000002"}');
  RAISE EXCEPTION 'Conflicting replay accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
RESET ROLE;
DO $$ DECLARE w uuid; cmd uuid:=gen_random_uuid(); before_stage text; cb uuid; before_key uuid; BEGIN
 SELECT id,stage INTO w,before_stage FROM public.oxygen_workflows WHERE merchant_id='10000000-0000-4000-8000-000000000001';
 INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status) VALUES(cmd,w,gen_random_uuid(),0,'web','{"action":"refresh_kyc"}','executing');
 PERFORM oxygen_private.record_command(cmd,'failed','reconciliation_required');
 IF (SELECT stage FROM public.oxygen_workflows WHERE id=w)<>before_stage THEN RAISE EXCEPTION 'Definite failure changed stage'; END IF;
 INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command) VALUES(w,gen_random_uuid(),0,'web','{"action":"refresh_kyc"}');
 DELETE FROM oxygen_private.commands WHERE workflow_id=w AND status='queued';
 SELECT id INTO cb FROM oxygen_private.callback_inbox WHERE event->>'kind'='address' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
 SELECT retry_key INTO before_key FROM oxygen_private.callback_inbox WHERE id=cb;
 FOR n IN 1..5 LOOP PERFORM public.oxygen_callback('defer','test-partner',jsonb_build_object('id',cb)); END LOOP;
 IF (SELECT retry_key FROM oxygen_private.callback_inbox WHERE id=cb)=before_key THEN RAISE EXCEPTION 'Callback retry key reused'; END IF;
 IF (SELECT status FROM oxygen_private.callback_inbox WHERE id=cb)<>'observed' THEN RAISE EXCEPTION 'Poison callback not retired'; END IF;
END $$;
\ir diagnostics.test.sql
ROLLBACK;
\echo 'PASS: scoped normal-Auth worker, secret isolation, durable claims/results, callback correlation and replay protection'
