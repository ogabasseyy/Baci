#!/usr/bin/env bash
set -euo pipefail

readonly DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SANDBOX="$(mktemp -d)"
readonly MOCK_DIRECTORY="${SANDBOX}/mock-bin"
readonly COMMAND_LOG="${SANDBOX}/commands.log"
readonly TLS_STATE="${SANDBOX}/tls-state"
readonly TLS_DIRECTORY_STATE="${SANDBOX}/tls-directory-state"

cleanup() {
  rm -rf -- "${SANDBOX}"
}
trap cleanup EXIT

mkdir -p "${MOCK_DIRECTORY}"
cp "${DIRECTORY}/install-isolated-postgres-tls-and-provisioner.sh" "${SANDBOX}/candidate.sh"
cp "${DIRECTORY}/provisioner-grants.sql" "${SANDBOX}/provisioner-grants.sql"
cp "${DIRECTORY}/provisioner-grants.test.sql" "${SANDBOX}/provisioner-grants.test.sql"
sed -i.bak "s#/etc/baci/piggyvest-staging#${SANDBOX}/secrets#g; s#/root/piggyvest-postgres-tls.#${SANDBOX}/tls.#g" "${SANDBOX}/candidate.sh"
rm -f -- "${SANDBOX}/candidate.sh.bak"
printf '%s\n' off > "${TLS_STATE}"
printf '%s\n' absent > "${TLS_DIRECTORY_STATE}"

cat > "${MOCK_DIRECTORY}/id" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 0
EOF

cat > "${MOCK_DIRECTORY}/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
EOF

cat > "${MOCK_DIRECTORY}/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == 'rand' ]]; then printf '%096d\n' 0; exit 0; fi
if [[ "$1" == 's_client' ]]; then exit 0; fi
for ((index = 1; index <= $#; index += 1)); do
  if [[ "${!index}" == '-out' ]]; then
    next=$((index + 1))
    : > "${!next}"
  fi
done
EOF

cat > "${MOCK_DIRECTORY}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${MOCK_COMMAND_LOG:?}"
state="${MOCK_TLS_STATE:?}"
tls_directory_state="${MOCK_TLS_DIRECTORY_STATE:?}"
if [[ "$1" == 'inspect' ]]; then
  case "$3" in
    '{{.Config.Image}}') printf '%s\n' 'supabase/postgres:17.6.1.136' ;;
    '{{.State.Running}}') printf '%s\n' true ;;
    '{{json .HostConfig.PortBindings}}') printf '%s\n' null ;;
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}') printf '%s\n' 172.23.0.2 ;;
  esac
  exit 0
fi
if [[ "$1" == 'cp' ]]; then
  printf '%s\n' "docker $*" >> "${log}"
  printf '%s\n' present > "${tls_directory_state}"
  exit 0
fi
[[ "$1" == 'exec' ]] || exit 1
printf '%s\n' "docker $*" >> "${log}"
if [[ " $* " == *' sh -ceu test ! -e '* ]]; then
  [[ "$(cat "${tls_directory_state}")" == absent ]]
  exit
fi
if [[ " $* " == *' sh -ceu mkdir -p '* ]]; then
  printf '%s\n' present > "${tls_directory_state}"
  exit 0
fi
if [[ " $* " == *' sh -ceu rm -rf '* ]]; then
  [[ "${MOCK_TLS_DELETE_FAIL:-0}" != '1' ]] || exit 1
  printf '%s\n' absent > "${tls_directory_state}"
  exit 0
fi
if [[ " $* " != *' psql '* ]]; then exit 0; fi
if [[ " $* " == *' -Atc '* ]]; then
  query="${*: -1}"
  case "${query}" in
    *to_regprocedure*) printf '%s\n' 10 ;;
    *aclexplode*) printf '%s\n' 0 ;;
    *pg_roles*) printf '%s\n' 0 ;;
    'SHOW ssl') cat "${state}" ;;
    'SHOW ssl_cert_file'|'SHOW ssl_key_file') printf '\n' ;;
  esac
  exit 0
fi
payload="$(cat)"
printf '%s\n' "${payload}" >> "${log}"
if [[ "${payload}" == *"ALTER SYSTEM SET ssl = 'on'"* ]]; then printf '%s\n' on > "${state}"; fi
if [[ "${payload}" == *"ALTER SYSTEM SET ssl = 'off'"* ]]; then
  [[ "${MOCK_TLS_RESTORE_FAIL:-0}" != '1' ]] || exit 1
  printf '%s\n' off > "${state}"
fi
if [[ "${payload}" == *'CREATE ROLE piggyvest_staging_provisioner'* ]]; then exit 1; fi
EOF

chmod 0700 "${MOCK_DIRECTORY}/id" "${MOCK_DIRECTORY}/timeout" "${MOCK_DIRECTORY}/openssl" "${MOCK_DIRECTORY}/docker"

run_candidate() {
  local name="$1"
  shift
  : > "${COMMAND_LOG}"
  printf '%s\n' off > "${TLS_STATE}"
  printf '%s\n' absent > "${TLS_DIRECTORY_STATE}"
  rm -rf -- "${SANDBOX}/secrets"

  set +e
  PATH="${MOCK_DIRECTORY}:${PATH}" MOCK_COMMAND_LOG="${COMMAND_LOG}" MOCK_TLS_STATE="${TLS_STATE}" MOCK_TLS_DIRECTORY_STATE="${TLS_DIRECTORY_STATE}" "$@" bash "${SANDBOX}/candidate.sh" --install > "${SANDBOX}/${name}.stdout" 2> "${SANDBOX}/${name}.stderr"
  status=$?
  set -e
  [[ "${status}" != '0' ]]
}

run_candidate rollback-role-transaction env
grep -Fq 'partial-failure' "${SANDBOX}/rollback-role-transaction.stderr"
grep -Fq 'cleanup":"completed' "${SANDBOX}/rollback-role-transaction.stderr"
[[ "$(cat "${TLS_STATE}")" == 'off' ]]
[[ "$(cat "${TLS_DIRECTORY_STATE}")" == 'absent' ]]
[[ ! -e "${SANDBOX}/secrets/postgres-provisioner.password" ]]
[[ ! -e "${SANDBOX}/secrets/postgres-ca.pem" ]]
log_min_error_line="$(grep -nF "SET log_min_error_statement = 'PANIC'" "${COMMAND_LOG}" | head -n 1 | cut -d: -f1)"
log_min_messages_line="$(grep -nF "SET log_min_messages = 'PANIC'" "${COMMAND_LOG}" | head -n 1 | cut -d: -f1)"
password_line="$(grep -nF '\set provisioner_password ' "${COMMAND_LOG}" | head -n 1 | cut -d: -f1)"
[[ "${log_min_error_line}" -lt "${password_line}" ]]
[[ "${log_min_messages_line}" -lt "${password_line}" ]]
if grep -Fq 'DROP OWNED BY piggyvest_staging_provisioner' "${COMMAND_LOG}"; then
  printf '%s\n' 'cleanup tried to drop ownership for an aborted role transaction' >&2
  exit 1
fi

run_candidate retain-artifacts-on-restore-failure env MOCK_TLS_RESTORE_FAIL=1
grep -Fq 'cleanup":"manual-required' "${SANDBOX}/retain-artifacts-on-restore-failure.stderr"
[[ "$(cat "${TLS_STATE}")" == 'on' ]]
[[ "$(cat "${TLS_DIRECTORY_STATE}")" == 'present' ]]
[[ -e "${SANDBOX}/secrets/postgres-provisioner.password" ]]
[[ -e "${SANDBOX}/secrets/postgres-ca.pem" ]]

printf '%s\n' 'funding-setup mocked installation failure tests passed'
