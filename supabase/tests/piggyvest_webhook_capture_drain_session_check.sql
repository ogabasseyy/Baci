-- Contract test: the session check of the PiggyVest webhook capture drain
-- executor (R5), run against live PostgreSQL.
--
-- The executor refuses a drain session unless the login's only membership
-- is piggyvest_webhook_capture_worker, itself a member of nothing. This
-- suite runs that exact query (no copy that could drift) against probe
-- roles created and rolled back here, so a weakened predicate fails here
-- even though the TypeScript tests only see a scripted client. It never
-- SETs ROLE into a probe role and asserts nothing about TLS, which the
-- replay connection may not use.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_webhook_capture_drain_session_check.sql

BEGIN;

-- The executor's session check (webhook-capture-pg-executor.ts), run
-- verbatim against probe roles created inside this rolled-back transaction
-- (ZSES1 a lone worker membership passes, ZSES2 an extra membership is
-- counted, ZSES3 a worker nested in another role is refused). The text
-- between the $verify$ markers is kept identical to the executor's by
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
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid() AND s.ssl
  ) AS tls
FROM pg_catalog.pg_roles login WHERE login.rolname = $2::text$verify$;
  v_row record;
BEGIN
  CREATE ROLE zz_capture_drain_probe_login
    LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
    IN ROLE piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row
    USING 'piggyvest_webhook_capture_worker', 'zz_capture_drain_probe_login';
  IF NOT (v_row.login_safe AND v_row.membership_count = 1 AND v_row.worker_membership) THEN
    RAISE EXCEPTION 'a lone worker membership was refused: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES1';
  END IF;

  CREATE ROLE zz_capture_drain_probe_extra NOLOGIN;
  GRANT zz_capture_drain_probe_extra TO zz_capture_drain_probe_login;
  EXECUTE v_sql INTO STRICT v_row
    USING 'piggyvest_webhook_capture_worker', 'zz_capture_drain_probe_login';
  IF v_row.membership_count <> 2 THEN
    RAISE EXCEPTION 'an extra membership was not counted: %', row_to_json(v_row)
      USING ERRCODE = 'ZSES2';
  END IF;
  REVOKE zz_capture_drain_probe_extra FROM zz_capture_drain_probe_login;

  CREATE ROLE zz_capture_drain_probe_parent NOLOGIN;
  GRANT zz_capture_drain_probe_parent TO piggyvest_webhook_capture_worker;
  EXECUTE v_sql INTO STRICT v_row
    USING 'piggyvest_webhook_capture_worker', 'zz_capture_drain_probe_login';
  IF v_row.worker_membership THEN
    RAISE EXCEPTION 'a worker nested in another role was accepted' USING ERRCODE = 'ZSES3';
  END IF;
END
$$;

ROLLBACK;
