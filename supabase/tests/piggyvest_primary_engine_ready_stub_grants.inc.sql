-- Part of piggyvest_primary_engine_ready_stub.sql (\ir): the function's
-- shape, its grants and the readiness reader role, asserted via the catalog.
-- Runs inside the entry file's transaction; not a standalone suite.

-- Shape: SECURITY DEFINER, pinned search_path, jsonb, owned by the role
-- running the suite (the migration owner), with an explicit ACL (a NULL ACL
-- would mean the default PUBLIC EXECUTE).
DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('piggyvest_primary.engine_ready(text)');
  v_proc record;
BEGIN
  PERFORM pg_temp.check(v_fn IS NOT NULL, 'engine_ready(text) is missing');
  SELECT p.prosecdef, p.proconfig, p.prorettype, p.proacl,
    pg_get_userbyid(p.proowner) AS owner,
    pg_get_function_identity_arguments(p.oid) AS arguments
  INTO v_proc FROM pg_proc p WHERE p.oid = v_fn;
  PERFORM pg_temp.check(v_proc.prosecdef, 'engine_ready must be SECURITY DEFINER');
  PERFORM pg_temp.check(v_proc.proconfig = ARRAY['search_path=pg_catalog'],
    'engine_ready must pin search_path to pg_catalog');
  PERFORM pg_temp.check(v_proc.prorettype = 'jsonb'::regtype,
    'engine_ready must return jsonb');
  PERFORM pg_temp.check(v_proc.arguments = 'p_surface text',
    'engine_ready must take exactly p_surface text');
  PERFORM pg_temp.check(v_proc.owner = current_user,
    'engine_ready must be owned by the migration owner');
  PERFORM pg_temp.check(v_proc.proacl IS NOT NULL,
    'engine_ready must have an explicit ACL');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM aclexplode(v_proc.proacl) a WHERE a.grantee = 0),
    'PUBLIC must not execute engine_ready');
  PERFORM pg_temp.check((
      SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)
      FROM aclexplode(v_proc.proacl) a
      WHERE a.grantee <> 0 AND pg_get_userbyid(a.grantee) <> current_user)
    = ARRAY['piggyvest_primary_readiness_reader'],
    'only the readiness reader may hold an explicit grant on engine_ready');
END $$;

-- Who can execute it, effective privileges included.
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
    'primary_bank_signed_intake', 'piggyvest_primary_provisioner',
    'piggyvest_primary_goal_provisioner', 'primary_card_authorizer',
    'primary_card_evidence']
  LOOP
    IF to_regrole(v_role) IS NULL THEN CONTINUE; END IF;
    PERFORM pg_temp.check(NOT has_function_privilege(v_role,
        'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
      format('%s must not execute engine_ready', v_role));
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['piggyvest_primary_readiness_reader',
    'piggyvest_primary_evidence', 'primary_bank_inbox_worker',
    'piggyvest_primary_authorizer']
  LOOP
    PERFORM pg_temp.check(to_regrole(v_role) IS NOT NULL,
      format('role %s is missing', v_role));
    PERFORM pg_temp.check(has_function_privilege(v_role,
        'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
      format('%s must execute engine_ready', v_role));
  END LOOP;
END $$;

-- The reader: NOLOGIN, no elevated attribute, a member of nothing, and
-- granted (inherit, never SET ROLE) to exactly the three listed roles. The
-- migration owner's own membership (PostgreSQL gives one to the role that
-- creates a role) is not a grant to a PiggyVest role and is ignored.
DO $$
DECLARE
  v_reader oid := to_regrole('piggyvest_primary_readiness_reader');
BEGIN
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = v_reader
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication),
    'the readiness reader must be NOLOGIN without elevated attributes');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_auth_members m WHERE m.member = v_reader),
    'the readiness reader must not be a member of any role');
  PERFORM pg_temp.check((
      SELECT array_agg(pg_get_userbyid(m.member)::text ORDER BY pg_get_userbyid(m.member)::text)
      FROM pg_auth_members m
      WHERE m.roleid = v_reader AND (m.inherit_option OR m.set_option)
        AND pg_get_userbyid(m.member) <> current_user)
    = ARRAY['piggyvest_primary_authorizer', 'piggyvest_primary_evidence',
      'primary_bank_inbox_worker'],
    'the readiness reader must be granted to exactly the three listed roles');
  PERFORM pg_temp.check((
      SELECT bool_and(m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
      FROM pg_auth_members m
      WHERE m.roleid = v_reader AND pg_get_userbyid(m.member) <> current_user),
    'each reader grant must inherit, without SET ROLE or admin');
END $$;

-- Holding the reader confers engine_ready and schema usage, nothing else:
-- no other function, relation, column or schema grant names it.
DO $$
DECLARE
  v_reader oid := to_regrole('piggyvest_primary_readiness_reader');
BEGIN
  PERFORM pg_temp.check((
      SELECT array_agg(p.oid::regprocedure::text)
      FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.proacl IS NOT NULL AND a.grantee = v_reader)
    = ARRAY['piggyvest_primary.engine_ready(text)'],
    'the readiness reader may hold EXECUTE on engine_ready only');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.relacl IS NOT NULL AND a.grantee = v_reader),
    'the readiness reader must hold no relation grant');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_attribute att, aclexplode(att.attacl) a
      WHERE att.attacl IS NOT NULL AND a.grantee = v_reader),
    'the readiness reader must hold no column grant');
  PERFORM pg_temp.check((
      SELECT array_agg(n.nspname || ':' || a.privilege_type)
      FROM pg_namespace n, aclexplode(n.nspacl) a
      WHERE n.nspacl IS NOT NULL AND a.grantee = v_reader)
    = ARRAY['piggyvest_primary:USAGE'],
    'the readiness reader may hold USAGE on piggyvest_primary only');
END $$;
