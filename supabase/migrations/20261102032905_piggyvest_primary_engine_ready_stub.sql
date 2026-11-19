-- Readiness gate for the PiggyVest ledger and transfer engine, in its
-- fail-closed stub form.
--
-- piggyvest_primary.engine_ready(surface) answers whether the engine fences
-- a money surface needs are in place, as {ready, missing[]}. Until the
-- enforcing check replaces this body (CREATE OR REPLACE, same signature),
-- it answers not ready for every surface. The inflow executor and the
-- bank-inbox worker ask it before any apply_inflow or claim, and treat
-- not ready, or any error asking, as the retryable 'prerequisite': no
-- wallet is credited and every delivery stays captured, so it credits once
-- after readiness passes.
--
-- Only the new NOLOGIN role piggyvest_primary_readiness_reader may execute
-- it. The reader is granted (inherit only, never SET ROLE) to the evidence,
-- bank-inbox worker and authorizer roles; later role changes grant it to
-- theirs. PUBLIC, anon, authenticated and service_role cannot execute it.
--
-- bank_role_safe refuses a bank-inbox worker session whose capability role
-- is a member of any role or can execute anything outside its allowlist, so
-- it is restated to accept exactly this reader (which must itself be
-- NOLOGIN, without elevated attributes and a member of nothing) and
-- engine_ready. Its checks move, unchanged otherwise, into
-- bank_role_violations(login, worker), which lists each violation for a
-- given login so the rules can be tested without logging in as the worker.
-- The intake keeps its exact rules: no reader, no engine_ready.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_readiness_reader') THEN
    CREATE ROLE piggyvest_primary_readiness_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  -- A role that already exists must have the intended shape: holding the
  -- reader must confer nothing beyond engine_ready.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'piggyvest_primary_readiness_reader'
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb
      AND NOT r.rolcreaterole AND NOT r.rolreplication)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'piggyvest_primary_readiness_reader') THEN
    RAISE EXCEPTION 'piggyvest_primary_readiness_reader exists with an unexpected shape' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION piggyvest_primary.engine_ready(p_surface text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- Stub: no engine fence is proven yet, whatever the surface.
  RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array('engine_readiness_not_installed'));
END $$;
COMMENT ON FUNCTION piggyvest_primary.engine_ready(text) IS
  'Fail-closed readiness stub for the PiggyVest engine: always not ready until the enforcing check replaces it.';
REVOKE ALL ON FUNCTION piggyvest_primary.engine_ready(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.engine_ready(text) TO piggyvest_primary_readiness_reader;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_readiness_reader;
GRANT piggyvest_primary_readiness_reader
  TO piggyvest_primary_evidence, primary_bank_inbox_worker, piggyvest_primary_authorizer
  WITH INHERIT TRUE, SET FALSE;

-- Every reason a bank-inbox session for p_login is unsafe, one row each:
-- capability:<role>  the capability role is missing, can log in or is elevated;
-- membership:<role>  the capability role is a member of a role it may not hold;
-- relation:<name>    the login holds a table or sequence privilege;
-- function:<sig>     the login can execute a function outside the allowlist;
-- missing:<action>   the login cannot execute an allowlisted function.
CREATE FUNCTION piggyvest_primary.bank_role_violations(p_login name, p_worker boolean)
RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  WITH capability AS (
    SELECT CASE WHEN p_worker IS TRUE THEN 'primary_bank_inbox_worker' ELSE 'primary_bank_signed_intake' END::name AS name
  ), allowed AS (
    SELECT entry.action, entry.arguments
    FROM (VALUES
      ('bank_role_safe', 'p_worker boolean', true, true),
      ('bank_inbox_readiness', 'p_integration uuid, p_environment text, p_scope jsonb', true, true),
      ('enqueue_bank_inbox', 'p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb', false, true),
      ('claim_bank_inbox', 'p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb', true, false),
      ('process_bank_inbox', 'p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb', true, false),
      ('retry_bank_inbox', 'p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb', true, false),
      ('engine_ready', 'p_surface text', true, false)
    ) AS entry(action, arguments, worker, intake)
    WHERE CASE WHEN p_worker IS TRUE THEN entry.worker ELSE entry.intake END
  )
  SELECT 'capability:' || capability.name FROM capability
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname = capability.name
    AND NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolbypassrls
    AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication)
  UNION ALL
  SELECT 'membership:' || parent.rolname
  FROM capability JOIN pg_roles role ON role.rolname = capability.name
    JOIN pg_auth_members membership ON membership.member = role.oid
    JOIN pg_roles parent ON parent.oid = membership.roleid
  WHERE NOT (p_worker IS TRUE AND parent.rolname = 'piggyvest_primary_readiness_reader'
    AND NOT parent.rolcanlogin AND NOT parent.rolsuper AND NOT parent.rolbypassrls
    AND NOT parent.rolcreaterole AND NOT parent.rolcreatedb AND NOT parent.rolreplication
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members nested WHERE nested.member = parent.oid))
  UNION ALL
  SELECT 'relation:' || relation.oid::regclass::text
  FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r','p','v','m','f','S') AND namespace.nspname NOT IN ('pg_catalog','information_schema')
    AND namespace.nspname NOT LIKE 'pg_%'
    AND CASE WHEN relation.relkind = 'S' THEN has_sequence_privilege(p_login, relation.oid, 'USAGE,SELECT,UPDATE')
      ELSE has_table_privilege(p_login, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END
  UNION ALL
  SELECT 'function:' || routine.oid::regprocedure::text
  FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname NOT IN ('pg_catalog','information_schema') AND namespace.nspname NOT LIKE 'pg_%'
    AND has_function_privilege(p_login, routine.oid, 'EXECUTE')
    AND NOT (namespace.nspname = 'piggyvest_primary' AND EXISTS (SELECT 1 FROM allowed
      WHERE allowed.action = routine.proname::text
        AND allowed.arguments = pg_get_function_identity_arguments(routine.oid)))
  UNION ALL
  SELECT 'missing:' || allowed.action || '(' || allowed.arguments || ')' FROM allowed
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'piggyvest_primary' AND routine.proname::text = allowed.action
      AND pg_get_function_identity_arguments(routine.oid) = allowed.arguments
      AND has_function_privilege(p_login, routine.oid, 'EXECUTE'))
$$;
REVOKE ALL ON FUNCTION piggyvest_primary.bank_role_violations(name, boolean)
  FROM PUBLIC, anon, authenticated, service_role, primary_bank_signed_intake, primary_bank_inbox_worker;

-- Same contract as 20261007230000 (the newest definition): true only when
-- the session login has no violation at all.
CREATE OR REPLACE FUNCTION piggyvest_primary.bank_role_safe(p_worker boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RETURN NOT EXISTS (SELECT 1 FROM piggyvest_primary.bank_role_violations(SESSION_USER, p_worker));
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.bank_role_safe(boolean)
  FROM PUBLIC, anon, authenticated, service_role, primary_bank_signed_intake, primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.bank_role_safe(boolean) TO primary_bank_signed_intake, primary_bank_inbox_worker;
COMMIT;
