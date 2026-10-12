\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA connector_constraint_guard_test;
CREATE TABLE connector_constraint_guard_test.decoy (
  connection_id text CONSTRAINT connector_grants_connection_id_key UNIQUE,
  token_hash text CONSTRAINT connector_grants_token_hash_key UNIQUE,
  refresh_token_hash text CONSTRAINT connector_grants_refresh_token_hash_key UNIQUE
);
ALTER TABLE public.connector_grants
  DROP CONSTRAINT connector_grants_connection_id_key,
  DROP CONSTRAINT connector_grants_token_hash_key,
  DROP CONSTRAINT connector_grants_refresh_token_hash_key;
\ir ../20261004184016_connector_grant_constraint_guards.sql
-- A second run must preserve all three constraints.
\ir ../20261004184016_connector_grant_constraint_guards.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.connector_grants'::regclass
      AND contype = 'u'
      AND conname IN ('connector_grants_connection_id_key',
        'connector_grants_token_hash_key', 'connector_grants_refresh_token_hash_key')) <> 3
  THEN RAISE EXCEPTION 'connector uniqueness constraints missing'; END IF;
END
$$;
ROLLBACK;
