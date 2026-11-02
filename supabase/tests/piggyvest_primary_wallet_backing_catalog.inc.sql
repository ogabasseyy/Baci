-- Part of piggyvest_primary_wallet_backing.sql (\ir): roles and privileges,
-- asserted through the catalog (a denied EXECUTE cannot be trapped on the
-- replay image). Runs inside the entry file's transaction.

-- The ledger operations role is a NOLOGIN group with no special attributes,
-- no memberships of its own and no members yet.
DO $$
DECLARE
  v_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_role FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_ledger_ops';
  PERFORM pg_temp.check(FOUND, 'piggyvest_primary_ledger_ops must exist');
  PERFORM pg_temp.check(NOT v_role.rolcanlogin AND NOT v_role.rolsuper AND NOT v_role.rolbypassrls
    AND NOT v_role.rolcreaterole AND NOT v_role.rolcreatedb AND NOT v_role.rolreplication,
    'piggyvest_primary_ledger_ops must be NOLOGIN with no special attributes');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.member = v_role.oid OR m.roleid = v_role.oid AND m.member NOT IN (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)),
    'piggyvest_primary_ledger_ops must have no memberships and no members');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_backed_writer'),
    'there is no backed_writer role');
END $$;

-- EXECUTE matrix: exactly these grants, nothing for PUBLIC, anon or
-- service_role; flip_to_backed and the hooks are owner-only (called from the
-- engine's SECURITY DEFINER settle), so no session can flip without a
-- confirmed move.
DO $$
DECLARE
  v_fn text;
  v_role text;
  v_expected boolean;
  v_functions text[] := ARRAY[
    'piggyvest_primary.backing_state(uuid,uuid)',
    'piggyvest_primary.is_backed(uuid,uuid)',
    'piggyvest_primary.assert_wallet_legacy(uuid,uuid)',
    'piggyvest_primary.begin_migration(uuid,uuid,uuid,numeric)',
    'piggyvest_primary.flip_to_backed(uuid,uuid,text)',
    'piggyvest_primary.flag_migration_review(uuid,uuid,text)',
    'piggyvest_primary.on_backed_flip_credit_deferred(uuid)',
    'piggyvest_primary.on_backed_flip_convert_obligations(uuid)',
    'piggyvest_primary.on_onboarding_verified(uuid)',
    'piggyvest_primary.onboarding_verified_hook_ready()',
    'public.get_my_wallet_backing_state(uuid)'];
  v_grants text[] := ARRAY[
    'piggyvest_primary_ledger_ops=piggyvest_primary.begin_migration(uuid,uuid,uuid,numeric)',
    'piggyvest_primary_ledger_ops=piggyvest_primary.flag_migration_review(uuid,uuid,text)',
    'piggyvest_primary_provisioner=piggyvest_primary.is_backed(uuid,uuid)',
    'authenticated=public.get_my_wallet_backing_state(uuid)'];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    PERFORM pg_temp.check(pg_catalog.to_regprocedure(v_fn) IS NOT NULL, v_fn || ' is missing');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      WHERE p.oid = pg_catalog.to_regprocedure(v_fn) AND a.grantee = 0),
      v_fn || ' must not be granted to PUBLIC');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure(v_fn) AND p.prosecdef
        AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
        AND p.proconfig @> ARRAY['search_path=""']),
      v_fn || ' must be SECURITY DEFINER, owned by the suite role, with search_path pinned empty');
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
      'piggyvest_primary_ledger_ops', 'piggyvest_primary_provisioner'] LOOP
      v_expected := (v_role || '=' || v_fn) = ANY (v_grants);
      PERFORM pg_temp.check(pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') = v_expected,
        format('%s EXECUTE on %s must be %s', v_role, v_fn, v_expected));
    END LOOP;
  END LOOP;
END $$;

-- The trigger guards are not callable as functions by any API role, and the
-- tables are deny-all: RLS on, a restrictive deny policy, no privilege for any
-- API or PiggyVest role.
DO $$
DECLARE
  v_table text;
  v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['piggyvest_primary.guard_wallet_backing()',
    'piggyvest_primary.guard_wallet_backing_events()',
    'piggyvest_primary.block_migrating_wallet_customer_deletion()'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_table, 'EXECUTE'),
        format('%s must not execute trigger function %s', v_role, v_table));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.customers'::regclass AND t.tgenabled = 'O'
      AND t.tgfoid = 'piggyvest_primary.block_migrating_wallet_customer_deletion()'::regprocedure),
    'the migrating-wallet deletion block must be installed on customers');
  FOREACH v_table IN ARRAY ARRAY['piggyvest_primary.wallet_backing', 'piggyvest_primary.wallet_backing_events'] LOOP
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = v_table::regclass AND relrowsecurity), v_table || ' must enable RLS');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid = v_table::regclass AND NOT polpermissive
        AND pg_catalog.pg_get_expr(polqual, polrelid) = 'false'), v_table || ' must carry a deny-all policy');
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
      'piggyvest_primary_ledger_ops', 'piggyvest_primary_provisioner'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_table_privilege(v_role, v_table,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
        format('%s must hold no privilege on %s', v_role, v_table));
      PERFORM pg_temp.check(NOT pg_catalog.has_any_column_privilege(v_role, v_table,
        'SELECT, INSERT, UPDATE, REFERENCES'), format('%s must hold no column grant on %s', v_role, v_table));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.check(pg_catalog.has_schema_privilege('piggyvest_primary_ledger_ops',
    'piggyvest_primary', 'USAGE'), 'ledger_ops needs schema usage for its two functions');
END $$;
