#!/usr/bin/env bash
set -euo pipefail

readonly DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly INSTALLER="${DIRECTORY}/install-isolated-postgres-tls-and-provisioner.sh"
readonly GRANTS="${DIRECTORY}/provisioner-grants.sql"
readonly ASSERTIONS="${DIRECTORY}/provisioner-grants.test.sql"

grep -Fq "readonly CONTAINER='baci-isolated-savings-db-1'" "${INSTALLER}"
grep -Fq "readonly PRIVATE_FQDN='piggyvest-db.staging.baci.internal'" "${INSTALLER}"
grep -Fq "docker inspect --format '{{json .HostConfig.PortBindings}}'" "${INSTALLER}"
grep -Fq "ALTER SYSTEM SET ssl = 'on'" "${INSTALLER}"
grep -Fq 'SELECT pg_catalog.pg_reload_conf()' "${INSTALLER}"
grep -Fq -- '-starttls postgres' "${INSTALLER}"
grep -Fq -- '-verify_hostname "${PRIVATE_FQDN}"' "${INSTALLER}"
grep -Fq 'installSetup()' "${INSTALLER}"
! grep -Fq 'install()' "${INSTALLER}"
! grep -Fq -- '-v provisioner_password=' "${INSTALLER}"
grep -Fq 'SET log_statement = '"'"'none'"'"'' "${INSTALLER}"
grep -Fq 'SET log_min_duration_statement = -1' "${INSTALLER}"
grep -Fq "SET log_min_error_statement = 'PANIC'" "${INSTALLER}"
grep -Fq "SET log_min_messages = 'PANIC'" "${INSTALLER}"
grep -Fq 'SET log_parameter_max_length_on_error = 0' "${INSTALLER}"
grep -Fq 'DROP OWNED BY %s; DROP ROLE %s' "${INSTALLER}"
grep -Fq "ALTER SYSTEM SET ssl = 'off'; ALTER SYSTEM SET ssl_cert_file = ''; ALTER SYSTEM SET ssl_key_file = ''" "${INSTALLER}"
! grep -Fq 'FROM PUBLIC;' "${GRANTS}"
grep -Fq 'cat "${SCRIPT_DIRECTORY}/provisioner-grants.sql"' "${INSTALLER}"
! grep -Fq ' -f "${SCRIPT_DIRECTORY}/provisioner-grants.sql"' "${INSTALLER}"
grep -Fq 'NOINHERIT' "${GRANTS}"
grep -Fq 'NOBYPASSRLS' "${GRANTS}"
grep -Fq 'CONNECTION LIMIT 3' "${GRANTS}"
[[ "$(grep -Fc 'GRANT EXECUTE ON FUNCTION piggyvest_staging.' "${GRANTS}")" == '10' ]]
grep -Fq "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA piggyvest_staging" "${GRANTS}"
grep -Fq "provisioner has direct object privilege" "${ASSERTIONS}"
grep -Fq "has_sequence_privilege" "${ASSERTIONS}"
grep -Fq "provisioner can execute a non-provisioning RPC" "${ASSERTIONS}"
grep -Fq "provisioner can execute unexpected RPC" "${ASSERTIONS}"
grep -Fq "provisioner is missing a recovery RPC grant" "${ASSERTIONS}"

if "${INSTALLER}" --invalid >/dev/null 2>&1; then
  printf '%s\n' 'installer accepted an invalid mode' >&2
  exit 1
fi

bash "${DIRECTORY}/install-isolated-postgres-tls-and-provisioner.mocked.test.sh"

printf '%s\n' 'funding-setup static tests passed'
