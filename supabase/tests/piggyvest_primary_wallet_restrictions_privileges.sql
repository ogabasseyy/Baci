-- Catalog test: who can reach the PiggyVest primary-wallet restriction store.
--   * piggyvest_primary.wallet_restrictions is deny-all: RLS on with a
--     restrictive false policy, and no table privilege for PUBLIC, the API
--     roles (service_role included) or the PiggyVest roles;
--   * record_wallet_restriction and lift_wallet_restriction are executable by
--     piggyvest_primary_evidence alone (evidence writes);
--   * wallet_restriction_state is executable by piggyvest_primary_evidence and
--     piggyvest_primary_authorizer alone (the spend gate reads);
--   * anon, authenticated and service_role get nothing, and PUBLIC holds no
--     EXECUTE;
--   * all three stay SECURITY DEFINER with a pinned search_path.
-- Privileges are read from the catalog only: a denied EXECUTE cannot be
-- trapped on the replay image, so no denial is probed by calling a function.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_wallet_restrictions_privileges.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Roles other than the owner and superusers that hold EXECUTE, sorted; PUBLIC
-- shows as '-'.
CREATE FUNCTION pg_temp.executors(p_fn regprocedure) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(acl.grantee::regrole::text ORDER BY acl.grantee::regrole::text), '{}')
  FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) acl
  WHERE p.oid = p_fn AND acl.grantee <> p.proowner AND acl.privilege_type = 'EXECUTE'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid = acl.grantee AND r.rolsuper)
$$;

-- The table.
DO $$
DECLARE
  v_table regclass := to_regclass('piggyvest_primary.wallet_restrictions');
  v_role text;
BEGIN
  PERFORM pg_temp.check(v_table IS NOT NULL, 'piggyvest_primary.wallet_restrictions is missing');
  PERFORM pg_temp.check(
    (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_table),
    'wallet_restrictions must have row level security enabled');
  PERFORM pg_temp.check(
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = v_table AND NOT pol.polpermissive AND pol.polcmd = '*'
        AND pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'false'
        AND pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) = 'false'
        AND pol.polroles = ARRAY[0::oid]),
    'wallet_restrictions must carry a restrictive deny-all policy for PUBLIC');
  PERFORM pg_temp.check(
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = v_table AND pol.polpermissive),
    'wallet_restrictions must have no permissive policy');
  PERFORM pg_temp.check(
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) acl
      WHERE c.oid = v_table AND acl.grantee = 0),
    'PUBLIC must hold no privilege on wallet_restrictions');
  FOREACH v_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'piggyvest_primary_evidence', 'piggyvest_primary_authorizer'
  ] LOOP
    PERFORM pg_temp.check(
      NOT pg_catalog.has_table_privilege(
        v_role, v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
      v_role || ' must hold no privilege on wallet_restrictions');
  END LOOP;
  PERFORM pg_temp.check(
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = v_table AND a.attname = 'provider_wallet_id' AND i.indpred IS NOT NULL),
    'wallet_restrictions must index active restrictions by provider wallet id');
END $$;

-- The functions.
DO $$
DECLARE
  v_record regprocedure := to_regprocedure(
    'piggyvest_primary.record_wallet_restriction(text,text,text,text,bigint,bigint,bigint,timestamptz)');
  v_lift regprocedure := to_regprocedure(
    'piggyvest_primary.lift_wallet_restriction(text,text,text,text,timestamptz)');
  v_state regprocedure := to_regprocedure(
    'piggyvest_primary.wallet_restriction_state(text)');
  v_fn regprocedure;
  v_role text;
BEGIN
  PERFORM pg_temp.check(v_record IS NOT NULL, 'record_wallet_restriction is missing');
  PERFORM pg_temp.check(v_lift IS NOT NULL, 'lift_wallet_restriction is missing');
  PERFORM pg_temp.check(v_state IS NOT NULL, 'wallet_restriction_state is missing');

  FOREACH v_fn IN ARRAY ARRAY[v_record, v_lift, v_state] LOOP
    PERFORM pg_temp.check(
      (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
       FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
      v_fn::text || ' must stay SECURITY DEFINER with a pinned search_path');
    PERFORM pg_temp.check(
      (SELECT proacl IS NOT NULL FROM pg_catalog.pg_proc WHERE oid = v_fn),
      v_fn::text || ' must carry an explicit ACL');
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(
        NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
        v_role || ' must not execute ' || v_fn::text);
    END LOOP;
  END LOOP;

  -- Evidence writes.
  FOREACH v_fn IN ARRAY ARRAY[v_record, v_lift] LOOP
    PERFORM pg_temp.check(
      pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_fn, 'EXECUTE'),
      'piggyvest_primary_evidence must execute ' || v_fn::text);
    PERFORM pg_temp.check(
      NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_fn, 'EXECUTE'),
      'piggyvest_primary_authorizer must not execute ' || v_fn::text);
    PERFORM pg_temp.check(
      pg_temp.executors(v_fn) = ARRAY['piggyvest_primary_evidence'],
      'only piggyvest_primary_evidence may hold EXECUTE on ' || v_fn::text);
  END LOOP;

  -- Evidence and the authorizer read.
  FOREACH v_role IN ARRAY ARRAY['piggyvest_primary_evidence', 'piggyvest_primary_authorizer'] LOOP
    PERFORM pg_temp.check(
      pg_catalog.has_function_privilege(v_role, v_state, 'EXECUTE'),
      v_role || ' must execute wallet_restriction_state');
    PERFORM pg_temp.check(
      pg_catalog.has_schema_privilege(v_role, 'piggyvest_primary', 'USAGE'),
      v_role || ' must have USAGE on piggyvest_primary');
  END LOOP;
  PERFORM pg_temp.check(
    pg_temp.executors(v_state)
      = ARRAY['piggyvest_primary_authorizer', 'piggyvest_primary_evidence'],
    'only evidence and the authorizer may hold EXECUTE on wallet_restriction_state');

  -- The API roles cannot even reach the schema.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(
      NOT pg_catalog.has_schema_privilege(v_role, 'piggyvest_primary', 'USAGE'),
      v_role || ' must not have USAGE on piggyvest_primary');
  END LOOP;
END $$;

ROLLBACK;
