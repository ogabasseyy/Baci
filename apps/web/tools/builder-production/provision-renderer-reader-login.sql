\set ON_ERROR_STOP on
-- Run only in an authorized maintenance window over verified TLS.
-- The initial password is entered at psql's hidden prompt.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('baci:experience-renderer-reader', 0));

SELECT NOT EXISTS (
  SELECT FROM pg_catalog.pg_roles WHERE rolname = 'baci_experience_renderer_reader_login'
) AS new_renderer_login
\gset

\if :new_renderer_login
CREATE ROLE baci_experience_renderer_reader_login LOGIN NOINHERIT NOSUPERUSER
  NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT baci_experience_renderer_reader TO baci_experience_renderer_reader_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET LOCAL password_encryption = 'scram-sha-256';
\password baci_experience_renderer_reader_login
\endif

DO $verify$
DECLARE
  login_role pg_catalog.pg_roles%ROWTYPE;
  reader_role oid;
BEGIN
  SELECT * INTO STRICT login_role FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_experience_renderer_reader_login';
  SELECT oid INTO STRICT reader_role FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_experience_renderer_reader'
      AND NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb
        OR rolcreaterole OR rolreplication OR rolinherit);
  IF NOT login_role.rolcanlogin OR login_role.rolsuper OR login_role.rolbypassrls
    OR login_role.rolcreatedb OR login_role.rolcreaterole
    OR login_role.rolreplication OR login_role.rolinherit
    OR NOT EXISTS (
      SELECT FROM pg_catalog.pg_auth_members
      WHERE member = login_role.oid AND roleid = reader_role AND set_option
    )
    OR EXISTS (
      SELECT FROM pg_catalog.pg_auth_members
      WHERE member = reader_role OR
        (member = login_role.oid AND (roleid <> reader_role OR admin_option OR inherit_option))
    )
    OR NOT EXISTS (
      SELECT FROM pg_catalog.pg_authid WHERE oid = login_role.oid
        AND rolpassword LIKE 'SCRAM-SHA-256$%'
        AND (rolvaliduntil IS NULL OR rolvaliduntil > current_timestamp)
    )
  THEN
    RAISE EXCEPTION 'unsafe_renderer_reader_login';
  END IF;
END
$verify$;
COMMIT;
