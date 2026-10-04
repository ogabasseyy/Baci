-- Local replay only: all synthetic data rolls back.
\set ON_ERROR_STOP on
BEGIN;
-- Match the established replay fixture audit identity; this is never run on production.
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id, email) VALUES
  ('e8130000-0000-4000-8000-000000000001','connector-owner@example.test'),
  ('e8130000-0000-4000-8000-000000000002','connector-staff@example.test');
INSERT INTO public.merchants(id, user_id, email, business_name, slug) VALUES
  ('e8130000-0000-4000-8000-000000000003','e8130000-0000-4000-8000-000000000001','connector-store@example.test','Connector regression','connector-owner-regression');
INSERT INTO public.staff_members(merchant_id,user_id,email,name,role,status,permissions) VALUES
  ('e8130000-0000-4000-8000-000000000003','e8130000-0000-4000-8000-000000000002','connector-staff@example.test','Connector Staff','admin','active','{"settings":{"edit":true}}');
SELECT set_config('request.jwt.claim.sub','e8130000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_connector_grant('e8130000-0000-4000-8000-000000000003','staff-must-not-connect','{}',ARRAY['orders:read'],false,NULL,repeat('1',64),repeat('2',64));
    RAISE EXCEPTION 'Staff must not create an owner-only connector grant';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','e8130000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  FOR i IN 1..50 LOOP
    PERFORM public.create_connector_grant('e8130000-0000-4000-8000-000000000003','owner-cap-'||i,'{}',ARRAY['orders:read'],true,NULL,repeat(md5('token-'||i),2),repeat(md5('refresh-'||i),2));
  END LOOP;
  BEGIN
    PERFORM public.create_connector_grant('e8130000-0000-4000-8000-000000000003','owner-over-cap','{}',ARRAY['orders:read'],true,NULL,repeat('a',64),repeat('b',64));
    RAISE EXCEPTION 'Connection limit was not enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'connector_connection_limit' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.connector_grants WHERE merchant_id='e8130000-0000-4000-8000-000000000003') <> 50 THEN
    RAISE EXCEPTION 'Unexpected connection count';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE public.merchants SET user_id='e8130000-0000-4000-8000-000000000002'
WHERE id='e8130000-0000-4000-8000-000000000003';
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE connector_gateway;
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_connector_grant_context(repeat(md5('token-1'),2),'orders:read','orders','view',NULL);
    RAISE EXCEPTION 'Former owner grant retained authority';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('connector_grant_forbidden','connector_scope_denied') THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
