\set ON_ERROR_STOP on
-- Execute over TLS with a role authorized to provision and validate credentials.
-- Validation requires SELECT on pg_catalog.pg_authid and returns no verifier.
-- On first run, enter the secret-store password at psql's hidden prompt.
-- psql encrypts it before sending ALTER ROLE. A rerun preserves the password.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('baci:builder-auth-login-provision', 0));

DO $validate$
BEGIN
  IF to_regclass('builder_authorization.connections') IS NULL OR NOT EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'baci_builder_auth_storage'
      AND NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb
               OR rolcreaterole OR rolreplication OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'builder_auth_storage_not_ready';
  END IF;
END
$validate$;

SELECT NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'baci_builder_auth_login'
) AS create_broker_login
\gset

\if :create_broker_login
CREATE ROLE baci_builder_auth_login LOGIN NOINHERIT NOSUPERUSER
  NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT baci_builder_auth_storage TO baci_builder_auth_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET LOCAL password_encryption = 'scram-sha-256';
\password baci_builder_auth_login
\endif

DO $verify$
DECLARE
  login_role pg_roles%ROWTYPE;
  storage_role oid;
BEGIN
  SELECT * INTO STRICT login_role FROM pg_roles
    WHERE rolname = 'baci_builder_auth_login';
  SELECT oid INTO STRICT storage_role FROM pg_roles
    WHERE rolname = 'baci_builder_auth_storage';
  IF NOT login_role.rolcanlogin OR login_role.rolsuper OR
     login_role.rolbypassrls OR login_role.rolcreatedb OR
     login_role.rolcreaterole OR login_role.rolreplication OR login_role.rolinherit OR
     pg_has_role(login_role.oid, 'authenticated', 'MEMBER') OR
     NOT EXISTS (
       SELECT FROM pg_auth_members WHERE member = login_role.oid
         AND roleid = storage_role AND set_option
     ) OR EXISTS (
       SELECT FROM pg_auth_members WHERE member = login_role.oid
         AND (roleid <> storage_role OR admin_option OR inherit_option)
     ) THEN
    RAISE EXCEPTION 'unsafe_builder_auth_login';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_authid
    WHERE oid = login_role.oid
      AND rolpassword LIKE 'SCRAM-SHA-256$%'
      AND (rolvaliduntil IS NULL OR rolvaliduntil > CURRENT_TIMESTAMP)
  ) THEN
    RAISE EXCEPTION 'builder_auth_login_password_required';
  END IF;
END
$verify$;

COMMIT;
