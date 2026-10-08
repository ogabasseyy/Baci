#!/usr/bin/env bash
set -euo pipefail

readonly CONTAINER='baci-isolated-savings-db-1'
readonly IMAGE_PREFIX='supabase/postgres:17.'
readonly DATABASE='postgres'
readonly ROLE='piggyvest_staging_provisioner'
readonly PRIVATE_FQDN='piggyvest-db.staging.baci.internal'
readonly TLS_DIRECTORY='/var/lib/postgresql/data/baci-piggyvest-tls'
readonly HOST_SECRET_DIRECTORY='/etc/baci/piggyvest-staging'
readonly HOST_SECRET_FILE="${HOST_SECRET_DIRECTORY}/postgres-provisioner.password"
readonly HOST_CA_FILE="${HOST_SECRET_DIRECTORY}/postgres-ca.pem"
readonly SCRIPT_SOURCE="${BASH_SOURCE[0]-}"
readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${SCRIPT_SOURCE:-.}")" && pwd -P)"

installation_active=0
tls_mutation_started=0
role_mutation_started=0
tls_files_created=0
host_secret_path_reserved=0
host_ca_path_reserved=0
temporary_directory=''
original_ssl=''
original_ssl_cert_file=''
original_ssl_key_file=''

fail() {
  printf '%s\n' "funding-setup: $*" >&2
  exit 1
}

container_query() {
  docker exec -i "${CONTAINER}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "${DATABASE}" "$@" 2>/dev/null
}

container_apply() {
  docker exec -i "${CONTAINER}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "${DATABASE}" >/dev/null 2>&1
}

container_setting() {
  container_query -Atc "SHOW $1" || fail "could not read PostgreSQL setting $1"
}

require_exact_target() {
  local image port_bindings
  image="$(docker inspect --format '{{.Config.Image}}' "${CONTAINER}" 2>/dev/null)" || fail 'target container is unavailable'
  [[ "${image}" == ${IMAGE_PREFIX}* ]] || fail 'unexpected PostgreSQL image'
  [[ "$(docker inspect --format '{{.State.Running}}' "${CONTAINER}" 2>/dev/null)" == 'true' ]] || fail 'database container is not running'
  port_bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "${CONTAINER}" 2>/dev/null)" || fail 'could not inspect container ports'
  [[ "${port_bindings}" == 'null' || "${port_bindings}" == '{}' ]] || fail 'refusing a container with published ports'
}

assert_installed_functions() {
  local count
  count="$(container_query -Atc "SELECT count(*) FROM (VALUES ('piggyvest_staging.resolve_wallet_mapping(uuid,text,text)'), ('piggyvest_staging.prepare_provisioning_intent(uuid,uuid,uuid,uuid,text,bytea)'), ('piggyvest_staging.claim_provisioning_intent(uuid,uuid,uuid,integer,text,text)'), ('piggyvest_staging.record_provisioning_result(uuid,uuid,uuid,uuid,text,text,text)'), ('piggyvest_staging.expire_provisioning_claim(uuid,uuid,uuid)'), ('piggyvest_staging.record_created_customer(uuid,uuid,uuid,uuid,text,text,text)'), ('piggyvest_staging.read_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text)'), ('piggyvest_staging.observe_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)'), ('piggyvest_staging.begin_provisioning_verification(uuid,uuid,uuid,uuid,uuid,text)'), ('piggyvest_staging.confirm_provisioning_recovery(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text)')) AS expected(identity) WHERE pg_catalog.to_regprocedure(expected.identity) IS NOT NULL")" || fail 'could not inspect provisioning RPC signatures'
  [[ "${count}" == '10' ]] || fail 'the installed provisioning RPC signatures do not match the runtime fixture'
}

assert_no_public_function_execution() {
  local count
  count="$(container_query -Atc "SELECT count(*) FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) AS privilege WHERE namespace.nspname = 'piggyvest_staging' AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'")" || fail 'could not inspect PUBLIC function privileges'
  [[ "${count}" == '0' ]] || fail 'refusing because PUBLIC can execute a piggyvest_staging function'
}

assert_role_absent() {
  [[ "$(container_query -Atc "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = '${ROLE}'")" == '0' ]] || fail 'provisioner role already exists; refusing rotation'
}

assert_tls_paths_absent() {
  docker exec -u 0 "${CONTAINER}" sh -ceu "test ! -e '${TLS_DIRECTORY}'" >/dev/null 2>&1 || fail 'TLS target directory already exists; refusing replacement'
}

wait_for_setting() {
  local name="$1" expected="$2" actual
  for _ in {1..10}; do
    actual="$(container_query -Atc "SHOW ${name}" 2>/dev/null || true)"
    [[ "${actual}" == "${expected}" ]] && return 0
    sleep 1
  done
  return 1
}

assert_safe_password_logging() {
  local pgaudit_setting
  pgaudit_setting="$(container_query -Atc "SELECT COALESCE((SELECT setting FROM pg_catalog.pg_settings WHERE name = 'pgaudit.log'), '')" 2>/dev/null)" || fail 'could not inspect database audit logging'
  [[ -z "${pgaudit_setting}" || "${pgaudit_setting}" == 'none' ]] || fail 'refusing because pgaudit could record a role password statement'
}

check() {
  require_exact_target
  assert_installed_functions
  assert_no_public_function_execution
  assert_role_absent
  assert_tls_paths_absent
  assert_safe_password_logging
  [[ "$(container_setting ssl)" == 'off' ]] || fail 'TLS is already configured; refusing replacement'
  [[ -z "$(container_setting ssl_cert_file)" && -z "$(container_setting ssl_key_file)" ]] || fail 'TLS certificate settings are already configured'
  [[ ! -e "${HOST_SECRET_FILE}" && ! -e "${HOST_CA_FILE}" ]] || fail 'staging credential or CA path already exists'
  command -v openssl >/dev/null || fail 'VPS host requires openssl for certificate generation'
  command -v timeout >/dev/null || fail 'VPS host requires timeout for bounded TLS verification'
  printf '%s\n' '{"result":"checked","container":"baci-isolated-savings-db-1","publicPort":"absent","role":"absent","tls":"not-installed"}'
}

cleanup_after_failure() {
  local exit_status=$?
  local cleanup_result='not-needed'
  local cleanup_proven=1
  local tls_settings_restored=1
  trap - EXIT
  if [[ "${installation_active}" == '1' && "${exit_status}" != '0' ]]; then
    if [[ "${role_mutation_started}" == '1' ]]; then
      if [[ "$(container_query -Atc "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = '${ROLE}'" 2>/dev/null || true)" == '1' ]]; then
        printf "SET log_statement = 'none'; DROP OWNED BY %s; DROP ROLE %s;\n" "${ROLE}" "${ROLE}" | container_apply || cleanup_proven=0
      fi
      [[ "$(container_query -Atc "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = '${ROLE}'" 2>/dev/null || true)" == '0' ]] || cleanup_proven=0
    fi
    if [[ "${tls_files_created}" == '1' || "${tls_mutation_started}" == '1' ]]; then
      if [[ "${tls_mutation_started}" == '1' ]]; then
        printf "ALTER SYSTEM SET ssl = 'off'; ALTER SYSTEM SET ssl_cert_file = ''; ALTER SYSTEM SET ssl_key_file = ''; SELECT pg_catalog.pg_reload_conf();\n" | container_apply || tls_settings_restored=0
      fi
      [[ "$(container_query -Atc 'SHOW ssl' 2>/dev/null || true)" == "${original_ssl}" ]] || tls_settings_restored=0
      [[ "$(container_query -Atc 'SHOW ssl_cert_file' 2>/dev/null || true)" == "${original_ssl_cert_file}" ]] || tls_settings_restored=0
      [[ "$(container_query -Atc 'SHOW ssl_key_file' 2>/dev/null || true)" == "${original_ssl_key_file}" ]] || tls_settings_restored=0
      [[ "${tls_settings_restored}" == '1' ]] || cleanup_proven=0
      if [[ "${cleanup_proven}" == '1' ]]; then
        docker exec -u 0 "${CONTAINER}" sh -ceu "rm -rf -- '${TLS_DIRECTORY}'" >/dev/null 2>&1 || cleanup_proven=0
      fi
    fi
    if [[ "${cleanup_proven}" == '1' ]]; then
      if [[ "${host_secret_path_reserved}" == '1' ]]; then rm -f -- "${HOST_SECRET_FILE}" >/dev/null 2>&1 || cleanup_proven=0; fi
      if [[ "${host_ca_path_reserved}" == '1' ]]; then rm -f -- "${HOST_CA_FILE}" >/dev/null 2>&1 || cleanup_proven=0; fi
    fi
    [[ "${cleanup_proven}" == '1' ]] && cleanup_result='completed' || cleanup_result='manual-required'
    printf '%s\n' "{\"result\":\"partial-failure\",\"cleanup\":\"${cleanup_result}\",\"role\":\"${ROLE}\"}" >&2
  fi
  if [[ -n "${temporary_directory}" ]]; then rm -rf -- "${temporary_directory}" >/dev/null 2>&1; fi
  exit "${exit_status}"
}

installSetup() {
  [[ "$(id -u)" == '0' ]] || fail '--install requires root on the VPS host'
  check
  installation_active=1
  trap cleanup_after_failure EXIT
  original_ssl="$(container_setting ssl)"
  original_ssl_cert_file="$(container_setting ssl_cert_file)"
  original_ssl_key_file="$(container_setting ssl_key_file)"

  local container_ip password
  container_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${CONTAINER}" 2>/dev/null)" || fail 'could not inspect container address'
  [[ "${container_ip}" =~ ^10\.|^172\.|^192\.168\. ]] || fail 'container does not have a private IPv4 address'
  temporary_directory="$(mktemp -d /root/piggyvest-postgres-tls.XXXXXXXX 2>/dev/null)" || fail 'could not create secure temporary directory'
  umask 077

  openssl genrsa -out "${temporary_directory}/ca.key" 4096 >/dev/null 2>&1 || fail 'could not generate staging CA key'
  openssl req -x509 -new -sha256 -days 30 -key "${temporary_directory}/ca.key" -subj '/CN=Baci PiggyVest isolated staging CA' -out "${temporary_directory}/ca.crt" >/dev/null 2>&1 || fail 'could not generate staging CA certificate'
  openssl genrsa -out "${temporary_directory}/server.key" 4096 >/dev/null 2>&1 || fail 'could not generate PostgreSQL key'
  openssl req -new -key "${temporary_directory}/server.key" -subj "/CN=${PRIVATE_FQDN}" -out "${temporary_directory}/server.csr" >/dev/null 2>&1 || fail 'could not generate PostgreSQL certificate request'
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "${PRIVATE_FQDN}" > "${temporary_directory}/server.ext"
  openssl x509 -req -sha256 -days 30 -in "${temporary_directory}/server.csr" -CA "${temporary_directory}/ca.crt" -CAkey "${temporary_directory}/ca.key" -CAcreateserial -extfile "${temporary_directory}/server.ext" -out "${temporary_directory}/server.crt" >/dev/null 2>&1 || fail 'could not issue PostgreSQL certificate'

  command install -d -m 0700 "${HOST_SECRET_DIRECTORY}" >/dev/null 2>&1 || fail 'could not create staging secret directory'
  host_ca_path_reserved=1
  command install -m 0444 "${temporary_directory}/ca.crt" "${HOST_CA_FILE}" >/dev/null 2>&1 || fail 'could not store staging CA certificate'
  host_secret_path_reserved=1
  openssl rand -hex 48 > "${HOST_SECRET_FILE}" 2>/dev/null || fail 'could not generate provisioner password'
  chmod 0400 "${HOST_SECRET_FILE}" >/dev/null 2>&1 || fail 'could not restrict provisioner password file'
  password="$(tr -d '\n' < "${HOST_SECRET_FILE}")"
  [[ "${password}" =~ ^[0-9a-f]{96}$ ]] || fail 'generated provisioner password is invalid'

  tls_files_created=1
  docker exec -u 0 "${CONTAINER}" mkdir -p "${TLS_DIRECTORY}" >/dev/null 2>&1 || fail 'could not create PostgreSQL TLS directory'
  docker cp "${temporary_directory}/ca.crt" "${CONTAINER}:${TLS_DIRECTORY}/ca.crt" >/dev/null 2>&1 || fail 'could not copy PostgreSQL CA certificate'
  docker cp "${temporary_directory}/server.crt" "${CONTAINER}:${TLS_DIRECTORY}/server.crt" >/dev/null 2>&1 || fail 'could not copy PostgreSQL certificate'
  docker cp "${temporary_directory}/server.key" "${CONTAINER}:${TLS_DIRECTORY}/server.key" >/dev/null 2>&1 || fail 'could not copy PostgreSQL key'
  docker exec -u 0 "${CONTAINER}" sh -ceu "chown -R postgres:postgres '${TLS_DIRECTORY}'; chmod 0700 '${TLS_DIRECTORY}'; chmod 0600 '${TLS_DIRECTORY}/server.key'; chmod 0644 '${TLS_DIRECTORY}/ca.crt' '${TLS_DIRECTORY}/server.crt'" >/dev/null 2>&1 || fail 'could not set PostgreSQL TLS file permissions'
  tls_mutation_started=1
  printf "ALTER SYSTEM SET ssl = 'on'; ALTER SYSTEM SET ssl_cert_file = '%s/server.crt'; ALTER SYSTEM SET ssl_key_file = '%s/server.key'; SELECT pg_catalog.pg_reload_conf();\n" "${TLS_DIRECTORY}" "${TLS_DIRECTORY}" | container_apply || fail 'could not configure PostgreSQL TLS'
  wait_for_setting ssl on || fail 'PostgreSQL did not enable TLS after reload'
  timeout 10s openssl s_client -starttls postgres -connect "${container_ip}:5432" -servername "${PRIVATE_FQDN}" -verify_hostname "${PRIVATE_FQDN}" -verify_return_error -CAfile "${HOST_CA_FILE}" </dev/null >/dev/null 2>&1 || fail 'TLS negotiation or hostname verification failed'

  role_mutation_started=1
  {
    printf "%s\n" "SET log_statement = 'none'; SET log_min_duration_statement = -1; SET log_min_duration_sample = -1; SET log_statement_sample_rate = 0; SET log_min_error_statement = 'PANIC'; SET log_min_messages = 'PANIC'; SET log_parameter_max_length = 0; SET log_parameter_max_length_on_error = 0;"
    printf '\\set provisioner_password %s\n' "${password}"
    cat "${SCRIPT_DIRECTORY}/provisioner-grants.sql"
    cat "${SCRIPT_DIRECTORY}/provisioner-grants.test.sql"
    printf '%s\n' 'COMMIT;'
  } | container_apply || fail 'could not create bounded provisioner role'
  unset password
  installation_active=0
  printf '%s\n' '{"result":"installed","tls":"verified","provisioner":"created","publicPort":"absent","password":"stored-server-side"}'
}

case "${1-}" in
  --check)
    [[ "$#" == '1' ]] || fail 'usage: --check or --install'
    check
    ;;
  --install)
    [[ "$#" == '1' ]] || fail 'usage: --check or --install'
    installSetup
    ;;
  *)
    fail 'usage: --check or --install'
    ;;
esac
