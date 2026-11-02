-- Part of piggyvest_primary_engine_schema.sql (\ir): catalog contract.
-- Denials are asserted through the catalog, never by calling a denied object
-- as an API role: a denied EXECUTE cannot be trapped on the replay image.
-- Runs inside the entry file's transaction, before any part replaces a stub.

\ir piggyvest_hook_ownership.inc.sql

-- Roles: dedicated, NOLOGIN, unprivileged.
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['piggyvest_primary_transfer_enqueuer', 'piggyvest_primary_transfer_worker',
    'piggyvest_primary_transfer_ops'] LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role AND NOT rolcanlogin
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication),
      format('%s must be an unprivileged NOLOGIN role', v_role));
  END LOOP;
END $$;

-- Tables: RLS with a restrictive deny-all policy and no grant to anyone.
DO $$
DECLARE
  v_table text;
  v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['house_wallets', 'transfer_kinds', 'transfer_authorities', 'transfer_limits',
    'bank_destinations', 'wallet_transfers', 'wallet_transfer_attempts', 'wallet_spend_holds', 'transfer_b_effects'] LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'piggyvest_primary' AND c.relname = v_table AND c.relrowsecurity),
      format('%s must have RLS enabled', v_table));
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'piggyvest_primary'
      AND tablename = v_table AND permissive = 'RESTRICTIVE' AND qual = 'false' AND with_check = 'false'),
      format('%s must have a restrictive deny-all policy', v_table));
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'piggyvest_primary_transfer_enqueuer',
      'piggyvest_primary_transfer_worker', 'piggyvest_primary_transfer_ops'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_table_privilege(v_role, 'piggyvest_primary.' || v_table,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), format('%s must hold no privilege on %s', v_role, v_table));
      PERFORM pg_temp.check(NOT pg_catalog.has_any_column_privilege(v_role, 'piggyvest_primary.' || v_table,
        'SELECT, INSERT, UPDATE, REFERENCES'), format('%s must hold no column privilege on %s', v_role, v_table));
    END LOOP;
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) acl
      WHERE c.oid = ('piggyvest_primary.' || v_table)::regclass AND acl.grantee = 0), format('%s must not be granted to PUBLIC', v_table));
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_schema_privilege(v_role, 'piggyvest_primary', 'USAGE'),
      format('%s must not reach the piggyvest_primary schema', v_role));
  END LOOP;
END $$;

-- Functions: every engine function is SECURITY DEFINER with a pinned
-- search_path and is never executable by PUBLIC or an API role. The
-- functions this change owns carry exactly their grants: the read helper and
-- the worker pass to their roles, nothing else to anyone. (The owner of a
-- stub or a define_once function may grant it to its own engine role.)
DO $$
DECLARE
  v_fn record;
  v_role text;
  v_grantees text;
BEGIN
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig,
      COALESCE((SELECT o.rule FROM pv_engine_ownership o WHERE o.function_name = p.proname), 'guard') AS rule
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_primary' AND (p.proname IN (SELECT function_name FROM pv_engine_ownership)
      OR p.proname IN ('read_house_wallets', 'house_wallets_guard', 'transfer_kinds_guard', 'bank_destinations_guard',
        'wallet_transfers_guard', 'wallet_transfers_row_version', 'wallet_transfer_attempts_guard',
        'wallet_spend_holds_guard', 'transfer_b_effects_guard')) LOOP
    PERFORM pg_temp.check(v_fn.prosecdef
      AND v_fn.proconfig IN (ARRAY['search_path=pg_catalog'], ARRAY['search_path=""']),
      format('%s must be SECURITY DEFINER with a pinned search_path', v_fn.proname));
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE'),
        format('%s must not execute %s', v_role, v_fn.proname));
    END LOOP;
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid = v_fn.oid AND acl.grantee = 0), format('%s must not be executable by PUBLIC', v_fn.proname));
    CONTINUE WHEN v_fn.rule IN ('stub', 'define_once');
    SELECT COALESCE(string_agg(pg_catalog.pg_get_userbyid(acl.grantee)::text, ','
        ORDER BY pg_catalog.pg_get_userbyid(acl.grantee)::text), '') INTO v_grantees
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid = v_fn.oid AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner;
    PERFORM pg_temp.check(v_grantees = CASE v_fn.proname
        WHEN 'read_house_wallets' THEN
          'piggyvest_primary_transfer_enqueuer,piggyvest_primary_transfer_ops,piggyvest_primary_transfer_worker'
        WHEN 'apply_requested_b_effects' THEN 'piggyvest_primary_transfer_worker'
        ELSE '' END,
      format('%s has unexpected EXECUTE grantees: %s', v_fn.proname, v_grantees));
  END LOOP;
END $$;

-- The manifest matches the catalog: every declared function exists, every
-- kind has its settled and failed hooks, and no unlisted hook exists.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN SELECT function_name FROM pv_engine_ownership WHERE rule <> 'define_once' LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'piggyvest_primary' AND p.proname = v_name), format('%s must exist', v_name));
  END LOOP;
  FOR v_name IN SELECT 'on_settled_' || kind FROM piggyvest_primary.transfer_kinds
    UNION ALL SELECT 'on_failed_' || kind FROM piggyvest_primary.transfer_kinds LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pv_engine_ownership WHERE function_name = v_name),
      format('kind hook %s must be in the ownership manifest', v_name));
  END LOOP;
  FOR v_name IN SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_primary' AND (p.proname LIKE 'on\_settled\_%' OR p.proname LIKE 'on\_failed\_%'
      OR p.proname LIKE 'on\_collect\_%' OR p.proname LIKE 'on\_refund\_%') LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pv_engine_ownership WHERE function_name = v_name),
      format('hook %s is missing from the ownership manifest', v_name));
  END LOOP;
END $$;

-- Hooks share one signature; every hook still carrying the declared stub
-- body returns 'noop'. An owner replacement drops the stub marker.
DO $$
DECLARE
  v_hook record;
  v_result text;
BEGIN
  FOR v_hook IN SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pv_engine_ownership o ON o.function_name = p.proname
    WHERE n.nspname = 'piggyvest_primary' AND o.rule IN ('stub', 'dispatcher')
      AND p.proname NOT IN ('enqueue_misrouted_interest_sweep', 'session_may_write_b') LOOP
    PERFORM pg_temp.check(pg_catalog.pg_get_function_identity_arguments(v_hook.oid) = 'p_transfer_id uuid, p_attempt_id uuid'
      AND pg_catalog.pg_get_function_result(v_hook.oid) = 'text', format('%s must take (transfer, attempt) and return text', v_hook.proname));
    CONTINUE WHEN position('engine-stub' IN v_hook.prosrc) = 0;
    EXECUTE format('SELECT piggyvest_primary.%I($1, NULL)', v_hook.proname) INTO v_result USING pg_temp.id(999);
    PERFORM pg_temp.check(v_result = 'noop', format('stub %s must return noop', v_hook.proname));
  END LOOP;
  PERFORM pg_temp.check(NOT piggyvest_primary.session_may_write_b(), 'the suite session must never write B');
END $$;
