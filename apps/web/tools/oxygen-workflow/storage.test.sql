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
CREATE TABLE public.orders(id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), customer_id uuid REFERENCES public.customers(id), total numeric, currency text, payment_status text, cancelled_at timestamptz);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_customer ON public.customers FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY self_order ON public.orders FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.user_id = auth.uid()));
GRANT SELECT ON public.orders,public.customers TO authenticated;
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
INSERT INTO public.orders VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',400000,'NGN','unpaid',NULL),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',400000,'NGN','unpaid',NULL),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',400000,'NGN','unpaid',NULL);
-- Simulate permissive hosted defaults: the migration must revoke them.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO authenticated, anon;
\ir ../../../../supabase/migrations/20261020142857_oxygen_shared_workflow.sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '30000000-0000-4000-8000-000000000001';
DO $$ DECLARE first_result jsonb; second_result jsonb; BEGIN
 first_result := public.oxygen_start_workflow('40000000-0000-4000-8000-000000000001');
 second_result := public.oxygen_start_workflow('40000000-0000-4000-8000-000000000001');
 IF first_result <> second_result OR first_result->>'stage' <> 'application_required' THEN RAISE EXCEPTION 'Resume is not idempotent'; END IF;
 BEGIN
  PERFORM public.oxygen_start_workflow('40000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'Cross-user write succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.oxygen_start_workflow('40000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'Mismatched merchant write succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.oxygen_workflows SET stage = 'activated';
  RAISE EXCEPTION 'Customer wrote provider state';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command)
   VALUES ((first_result->>'id')::uuid,gen_random_uuid(),0,'chat','{"action":"activate"}');
  RAISE EXCEPTION 'Customer inserted a command';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.orders SET payment_status = 'paid' WHERE id = '40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.oxygen_start_workflow('40000000-0000-4000-8000-000000000001','mobile');
END $$;
SET LOCAL request.jwt.claim.sub = '30000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.oxygen_workflows) THEN RAISE EXCEPTION 'Cross-user read leaked'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_start_workflow('40000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'Anonymous workflow creation succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command)
 SELECT '50000000-0000-4000-8000-000000000001',id,gen_random_uuid(),version,'chat','{"action":"start_application"}'
 FROM public.oxygen_workflows;
SET LOCAL ROLE oxygen_workflow_worker;
DO $$ DECLARE result jsonb; BEGIN
 result := oxygen_private.claim_command('50000000-0000-4000-8000-000000000001');
 IF result->>'environment' <> 'staging' THEN RAISE EXCEPTION 'Missing environment binding'; END IF;
 IF oxygen_private.claim_command('50000000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Executing command reclaimed'; END IF;
 PERFORM oxygen_private.record_command('50000000-0000-4000-8000-000000000001','indeterminate','reconciliation_required');
 IF oxygen_private.claim_command('50000000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'Indeterminate command reclaimed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE version = 1 AND stage = 'reconciliation_required') THEN RAISE EXCEPTION 'Result not persisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.history WHERE version = 1) THEN RAISE EXCEPTION 'History missing'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: resume, ownership, tenant isolation, RLS, forbidden writes and anonymous denial'
