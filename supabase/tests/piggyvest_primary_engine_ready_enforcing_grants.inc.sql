-- Part of piggyvest_primary_engine_ready_enforcing.sql (\ir): fail-closed
-- behaviour and the unchanged grants. Runs inside the entry file's
-- transaction; not a standalone suite.

-- 5. Fail closed: engine_ready answers not ready when the check errors.
SAVEPOINT fail_closed;
CREATE OR REPLACE FUNCTION piggyvest_primary.engine_fences(p_surface text, p_login name)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'boom'; END $$;
SELECT pg_temp.check(piggyvest_primary.engine_ready('inflow')
    = '{"ready": false, "missing": ["engine_readiness_unavailable"]}'::jsonb,
  'an error inside the check must answer not ready');
ROLLBACK TO SAVEPOINT fail_closed;
SAVEPOINT null_fences;
CREATE OR REPLACE FUNCTION piggyvest_primary.engine_fences(p_surface text, p_login name)
RETURNS text[] LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT NULL::text[] $$;
SELECT pg_temp.check(piggyvest_primary.engine_ready('inflow')
    = '{"ready": false, "missing": ["engine_readiness_unavailable"]}'::jsonb,
  'a NULL answer from the check must not read as ready');
ROLLBACK TO SAVEPOINT null_fences;
SAVEPOINT empty_fences;
CREATE OR REPLACE FUNCTION piggyvest_primary.engine_fences(p_surface text, p_login name)
RETURNS text[] LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT ARRAY[]::text[] $$;
SELECT pg_temp.check(piggyvest_primary.engine_ready('inflow')
    = '{"ready": true, "missing": []}'::jsonb,
  'an empty missing list is the only ready answer');
ROLLBACK TO SAVEPOINT empty_fences;

-- 6. Grants unchanged, asserted through the catalog.
DO $$
DECLARE
  v_role text;
  v_acl aclitem[];
BEGIN
  SELECT p.proacl INTO v_acl FROM pg_proc p
  WHERE p.oid = 'piggyvest_primary.engine_ready(text)'::regprocedure;
  PERFORM pg_temp.check(v_acl IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0),
    'PUBLIC must not execute engine_ready');
  PERFORM pg_temp.check((
      SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)
      FROM aclexplode(v_acl) a
      WHERE a.grantee <> 0 AND pg_get_userbyid(a.grantee) <> current_user)
    = ARRAY['piggyvest_primary_readiness_reader'],
    'only the readiness reader may hold an explicit grant on engine_ready');
  PERFORM pg_temp.check((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND p.prorettype = 'jsonb'::regtype
      AND pg_get_function_identity_arguments(p.oid) = 'p_surface text'
      FROM pg_proc p WHERE p.oid = 'piggyvest_primary.engine_ready(text)'::regprocedure),
    'engine_ready must keep its signature, SECURITY DEFINER and pinned search_path');
  FOREACH v_role IN ARRAY ARRAY['piggyvest_primary_readiness_reader',
    'piggyvest_primary_evidence', 'primary_bank_inbox_worker', 'piggyvest_primary_authorizer'] LOOP
    PERFORM pg_temp.check(has_function_privilege(v_role,
        'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
      format('%s must still execute engine_ready', v_role));
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
    'primary_bank_signed_intake'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(v_role,
        'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
      format('%s must not execute engine_ready', v_role));
  END LOOP;
  -- The rules function is reachable by nobody but its owner.
  SELECT p.proacl INTO v_acl FROM pg_proc p
  WHERE p.oid = 'piggyvest_primary.engine_fences(text,name)'::regprocedure;
  PERFORM pg_temp.check(v_acl IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM aclexplode(v_acl) a
      WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) <> current_user),
    'engine_fences must have no grant but the owner''s');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
    'piggyvest_primary_readiness_reader', 'piggyvest_primary_evidence',
    'primary_bank_inbox_worker', 'piggyvest_primary_authorizer'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(v_role,
        'piggyvest_primary.engine_fences(text,name)', 'EXECUTE'),
      format('%s must not execute engine_fences', v_role));
  END LOOP;
  -- Holding the reader still confers engine_ready only.
  PERFORM pg_temp.check((
      SELECT array_agg(p.oid::regprocedure::text)
      FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.proacl IS NOT NULL
        AND a.grantee = to_regrole('piggyvest_primary_readiness_reader'))
    = ARRAY['piggyvest_primary.engine_ready(text)'],
    'the readiness reader may hold EXECUTE on engine_ready only');
END $$;

