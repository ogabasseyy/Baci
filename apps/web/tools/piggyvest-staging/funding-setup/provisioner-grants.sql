-- Staging-only grants for the executor's provisioning statement allowlist.
-- The installer supplies :provisioner_password through psql variable binding.
\set ON_ERROR_STOP on

BEGIN;

DO $create_role$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_staging_provisioner'
  ) THEN
    RAISE EXCEPTION 'piggyvest_staging_provisioner already exists';
  END IF;
END
$create_role$;

CREATE ROLE piggyvest_staging_provisioner
  LOGIN
  NOINHERIT
  NOBYPASSRLS
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  CONNECTION LIMIT 3
  PASSWORD :'provisioner_password';

REVOKE ALL PRIVILEGES ON SCHEMA piggyvest_staging
  FROM piggyvest_staging_provisioner;
GRANT USAGE ON SCHEMA piggyvest_staging TO piggyvest_staging_provisioner;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA piggyvest_staging
  FROM piggyvest_staging_provisioner;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA piggyvest_staging
  FROM piggyvest_staging_provisioner;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA piggyvest_staging
  FROM piggyvest_staging_provisioner;

GRANT EXECUTE ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text)
  TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.prepare_provisioning_intent(
  uuid, uuid, uuid, uuid, text, bytea
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.claim_provisioning_intent(
  uuid, uuid, uuid, integer, text, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.record_provisioning_result(
  uuid, uuid, uuid, uuid, text, text, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.expire_provisioning_claim(uuid, uuid, uuid)
  TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.record_created_customer(
  uuid, uuid, uuid, uuid, text, text, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.read_provisioning_recovery(
  uuid, uuid, uuid, uuid, uuid, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.observe_provisioning_recovery(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.begin_provisioning_verification(
  uuid, uuid, uuid, uuid, uuid, text
) TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.confirm_provisioning_recovery(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text
) TO piggyvest_staging_provisioner;
