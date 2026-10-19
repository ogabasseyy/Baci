\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $lockdown$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_storage_initializer') THEN
    ALTER ROLE baci_storage_initializer NOLOGIN PASSWORD NULL;
    REVOKE CONNECT ON DATABASE postgres FROM baci_storage_initializer;
  END IF;
END
$lockdown$;
COMMIT;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'baci_storage_initializer' AND pid <> pg_backend_pid();
