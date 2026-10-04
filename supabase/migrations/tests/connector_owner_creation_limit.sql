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
-- Staff cannot inspect owner credential metadata through direct table reads.
SELECT set_config('request.jwt.claim.sub','e8130000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.connector_grants WHERE merchant_id='e8130000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'Staff can read owner connector metadata';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
-- Independent connector credentials must honor live account suspension/deletion.
UPDATE auth.users SET banned_until=now()+interval '1 day'
WHERE id='e8130000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_connector_grant_context(repeat(md5('token-1'),2),'orders:read','orders','view',NULL);
    RAISE EXCEPTION 'Banned owner retained access';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'connector_user_suspended' THEN RAISE; END IF;
  END;
END $$;
UPDATE auth.users SET banned_until=NULL, deleted_at=now()
WHERE id='e8130000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_connector_grant_context(repeat(md5('token-1'),2),'orders:read','orders','view',NULL);
    RAISE EXCEPTION 'Deleted owner retained access';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'connector_user_suspended' THEN RAISE; END IF;
  END;
END $$;
UPDATE auth.users SET deleted_at=NULL
WHERE id='e8130000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resolve_connector_grant_context(repeat(md5('token-1'),2),'orders:read','orders','view',NULL)) THEN
    RAISE EXCEPTION 'Restored owner cannot resolve grant';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE public.merchants SET user_id='e8130000-0000-4000-8000-000000000002'
WHERE id='e8130000-0000-4000-8000-000000000003';
SELECT set_config('request.jwt.claim.role','authenticated',true);
-- The managed replay administrator cannot SET ROLE into newly created roles.
-- Check the role's execution grant, then exercise the SECURITY DEFINER body
-- as its owner; the body resolves the linked user from the credential itself.
DO $$ BEGIN
  IF NOT has_function_privilege('connector_gateway', 'public.resolve_connector_grant_context(text,text,text,text,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Gateway cannot execute its resolver';
  END IF;
  IF has_function_privilege('authenticated', 'public.resolve_connector_grant_context(text,text,text,text,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users can execute the gateway resolver';
  END IF;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_connector_grant_context(repeat(md5('token-1'),2),'orders:read','orders','view',NULL);
    RAISE EXCEPTION 'Former owner grant retained authority';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('connector_grant_forbidden','connector_scope_denied') THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
