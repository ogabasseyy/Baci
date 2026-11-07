-- Contract test: the session check of the PiggyVest webhook capture drain
-- executor (R5), run against live PostgreSQL.
--
-- The executor refuses a drain session unless the login's only membership
-- is piggyvest_webhook_capture_worker (itself a member of nothing), the
-- login can actually use that role's grants, nothing (PUBLIC included) gives
-- it the capture table or functions, and it holds no privilege by name
-- beyond the three entry points. This suite runs that exact query (no copy
-- that could drift) against probe roles created and rolled back here, so a
-- weakened predicate fails here even though the TypeScript tests only see a
-- scripted client. It never SETs ROLE into a probe role and asserts nothing
-- about TLS, which the replay connection may not use.
--
-- The count of named privileges is also checked against the catalog's own
-- answer: through has_*_privilege, which follows inheritance and PUBLIC, the
-- login may use no function, relation or sequence that the anonymous anon
-- role (which holds exactly what PUBLIC grants) cannot, apart from the
-- three entry points. So everything the login holds beyond the drain is
-- what PUBLIC already gives every role.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_webhook_capture_drain_session_check.sql

BEGIN;

-- The executor's session check (webhook-capture-pg-executor.ts), run
-- verbatim against probe roles created inside this rolled-back transaction:
-- ZSES1 a lone worker membership passes every check, ZSES2 an extra
-- membership is counted, ZSES3 a worker nested in another role is refused,
-- ZSES4 a login that cannot inherit the worker's grants is refused, ZSES5 a
-- privilege granted to the login by name is counted (directly and through
-- the worker role), ZSES6 a PUBLIC grant on the capture surface is refused
-- while a PUBLIC-only grant is not counted, ZSES7 the count agrees with the
-- catalog's has_*_privilege answers compared with anon. The text between
-- the $verify$ markers is kept identical to the executor's by
-- webhook-capture-pg-executor.sql-contract.test.ts.
DO $$
DECLARE
  v_sql constant text := $verify$SELECT pg_catalog.current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolbypassrls
    AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication) AS login_safe,
  (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member = login.oid)::integer AS membership_count,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles worker ON worker.oid = m.roleid
    WHERE m.member = login.oid AND worker.rolname = $1::text AND NOT m.admin_option
      AND NOT worker.rolcanlogin AND NOT worker.rolsuper AND NOT worker.rolbypassrls
      AND NOT worker.rolcreaterole AND NOT worker.rolcreatedb AND NOT worker.rolreplication
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members parent WHERE parent.member = worker.oid)
  ) AS worker_membership,
  (
    pg_catalog.has_schema_privilege(login.oid, 'public', 'USAGE')
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.claim_piggyvest_webhook_captures(integer,integer,integer)'), 'EXECUTE'), false)
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'), 'EXECUTE'), false)
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.piggyvest_webhook_capture_status()'), 'EXECUTE'), false)
  ) AS grants_usable,
  NOT (
    COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.capture_piggyvest_webhook_delivery(jsonb)'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.piggyvest_webhook_captures_immutable_evidence()'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_table_privilege(login.oid, pg_catalog.to_regclass('public.piggyvest_webhook_captures'), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), false)
    OR COALESCE(pg_catalog.has_any_column_privilege(login.oid, pg_catalog.to_regclass('public.piggyvest_webhook_captures'), 'SELECT, INSERT, UPDATE, REFERENCES'), false)
  ) AS capture_surface_denied,
  (
    SELECT count(*)::integer FROM pg_catalog.pg_shdepend d
    WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND d.deptype IN ('a', 'o')
      AND d.dbid IN (0, (SELECT db.oid FROM pg_catalog.pg_database db WHERE db.datname = pg_catalog.current_database()))
      AND d.refobjid IN (SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(login.oid, r.oid, 'USAGE'))
      AND NOT (d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objsubid = 0 AND d.objid = ANY (ARRAY[
        COALESCE(pg_catalog.to_regprocedure('public.claim_piggyvest_webhook_captures(integer,integer,integer)')::oid, 0),
        COALESCE(pg_catalog.to_regprocedure('public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)')::oid, 0),
        COALESCE(pg_catalog.to_regprocedure('public.piggyvest_webhook_capture_status()')::oid, 0)]))
      AND NOT (d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND d.objid = 'public'::pg_catalog.regnamespace)
  ) + (
    SELECT count(*)::integer FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE n.nspname = 'public' AND acl.privilege_type <> 'USAGE'
      AND acl.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(login.oid, r.oid, 'USAGE'))
  ) AS unexpected_privileges,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid() AND s.ssl
  ) AS tls
FROM pg_catalog.pg_roles login WHERE login.rolname = $2::text$verify$;
  v_worker constant text := 'piggyvest_webhook_capture_worker';
  v_login constant text := 'zz_capture_drain_probe_login';
  v_row record;
  v_beyond_anon integer;
BEGIN
  CREATE ROLE zz_capture_drain_probe_login
    LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
    IN ROLE piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF NOT (v_row.login_safe AND v_row.membership_count = 1 AND v_row.worker_membership
    AND v_row.grants_usable AND v_row.capture_surface_denied
    AND v_row.unexpected_privileges = 0) THEN
    RAISE EXCEPTION 'a lone worker membership was refused: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES1';
  END IF;

  CREATE ROLE zz_capture_drain_probe_extra NOLOGIN;
  GRANT zz_capture_drain_probe_extra TO zz_capture_drain_probe_login;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.membership_count <> 2 THEN
    RAISE EXCEPTION 'an extra membership was not counted: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES2';
  END IF;
  REVOKE zz_capture_drain_probe_extra FROM zz_capture_drain_probe_login;

  CREATE ROLE zz_capture_drain_probe_parent NOLOGIN;
  GRANT zz_capture_drain_probe_parent TO piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.worker_membership THEN
    RAISE EXCEPTION 'a worker nested in another role was accepted' USING ERRCODE = 'ZSES3';
  END IF;
  REVOKE zz_capture_drain_probe_parent FROM piggyvest_webhook_capture_worker;

  -- ZSES4: a member that does not inherit cannot use the worker's grants
  -- (rolinherit before PostgreSQL 16, the membership's inherit option after).
  CREATE ROLE zz_capture_drain_probe_noinherit
    LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
    IN ROLE piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, 'zz_capture_drain_probe_noinherit';
  IF v_row.grants_usable OR NOT v_row.worker_membership THEN
    RAISE EXCEPTION 'a login that cannot inherit the worker grants was accepted: %',
      row_to_json(v_row) USING ERRCODE = 'ZSES4';
  END IF;

  -- ZSES5: a privilege held by name, directly or through the worker role,
  -- is counted; the same grant to a login that does not inherit is not.
  CREATE FUNCTION public.zz_capture_drain_probe_fn() RETURNS integer
    LANGUAGE sql AS 'SELECT 1';
  REVOKE ALL ON FUNCTION public.zz_capture_drain_probe_fn() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.zz_capture_drain_probe_fn() TO zz_capture_drain_probe_login;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.unexpected_privileges <> 1 THEN
    RAISE EXCEPTION 'a function granted to the login was not counted: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES5';
  END IF;
  REVOKE ALL ON FUNCTION public.zz_capture_drain_probe_fn() FROM zz_capture_drain_probe_login;
  GRANT EXECUTE ON FUNCTION public.zz_capture_drain_probe_fn() TO piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.unexpected_privileges <> 1 THEN
    RAISE EXCEPTION 'a function granted to the worker role was not counted: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES5';
  END IF;
  REVOKE ALL ON FUNCTION public.zz_capture_drain_probe_fn() FROM piggyvest_webhook_capture_worker;

  -- ZSES6: PUBLIC reaches every role, so a PUBLIC grant on the capture
  -- surface must fail the check even though it names no role; a PUBLIC grant
  -- elsewhere is what anon holds too and is not counted.
  GRANT EXECUTE ON FUNCTION public.zz_capture_drain_probe_fn() TO PUBLIC;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.unexpected_privileges <> 0 OR NOT v_row.capture_surface_denied THEN
    RAISE EXCEPTION 'a PUBLIC-only grant elsewhere was counted or refused: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES6';
  END IF;
  GRANT EXECUTE ON FUNCTION public.capture_piggyvest_webhook_delivery(jsonb) TO PUBLIC;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.capture_surface_denied THEN
    RAISE EXCEPTION 'a PUBLIC grant on the capture function was accepted' USING ERRCODE = 'ZSES6';
  END IF;
  REVOKE ALL ON FUNCTION public.capture_piggyvest_webhook_delivery(jsonb) FROM PUBLIC;
  GRANT SELECT ON public.piggyvest_webhook_captures TO PUBLIC;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_row.capture_surface_denied THEN
    RAISE EXCEPTION 'a PUBLIC grant on the capture table was accepted' USING ERRCODE = 'ZSES6';
  END IF;
  REVOKE ALL ON TABLE public.piggyvest_webhook_captures FROM PUBLIC;

  -- ZSES7: the count agrees with the catalog's own answer. Whatever the
  -- login may use through has_*_privilege (inheritance and PUBLIC included)
  -- and anon may not, apart from the three entry points, is nothing.
  -- OFFSET 0 keeps each privilege function off relations of the wrong kind.
  SELECT
    (SELECT count(*) FROM (SELECT p.oid FROM pg_catalog.pg_proc p OFFSET 0) p
      WHERE pg_catalog.has_function_privilege(v_login, p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND p.oid <> ALL (ARRAY[
          'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure::oid,
          'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure::oid,
          'public.piggyvest_webhook_capture_status()'::regprocedure::oid]))
    + (SELECT count(*) FROM (
        SELECT c.oid FROM pg_catalog.pg_class c
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') OFFSET 0) c
      WHERE pg_catalog.has_any_column_privilege(v_login, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
    + (SELECT count(*) FROM (
        SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relkind = 'S' OFFSET 0) c
      WHERE pg_catalog.has_sequence_privilege(v_login, c.oid, 'USAGE, SELECT, UPDATE')
        AND NOT pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE'))
    INTO v_beyond_anon;
  EXECUTE v_sql INTO STRICT v_row USING v_worker, v_login;
  IF v_beyond_anon <> 0 OR v_row.unexpected_privileges <> 0 THEN
    RAISE EXCEPTION 'the drain login holds % object privileges beyond anon and the drain (named count %)',
      v_beyond_anon, v_row.unexpected_privileges USING ERRCODE = 'ZSES7';
  END IF;
END
$$;

ROLLBACK;
