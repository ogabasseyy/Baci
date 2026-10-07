#!/usr/bin/env bash
set -euo pipefail

unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE

POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
readonly POSTGRES_BIN
OPENSSL_BIN="${OPENSSL_BIN:-/opt/homebrew/opt/openssl@3/bin/openssl}"
readonly OPENSSL_BIN
readonly PRIVATE_FQDN='piggyvest-db.staging.baci.internal'
readonly PORT="$((56000 + RANDOM % 1000))"
TEMPORARY_DIRECTORY="$(mktemp -d /tmp/baci-piggyvest-tls.XXXXXX)"
readonly TEMPORARY_DIRECTORY
readonly SOCKET_DIRECTORY="${TEMPORARY_DIRECTORY}/socket"
readonly CERTIFICATE_DIRECTORY="${TEMPORARY_DIRECTORY}/certificates"
postgres_started=0

fail() {
  printf '%s\n' "local TLS rehearsal: $*" >&2
  exit 1
}

cleanup() {
  local exit_status=$?
  trap - EXIT
  if [[ "${postgres_started}" == '1' && -f "${TEMPORARY_DIRECTORY}/data/postmaster.pid" ]]; then
    if ! "${POSTGRES_BIN}/pg_ctl" -D "${TEMPORARY_DIRECTORY}/data" -m immediate stop >/dev/null 2>&1; then
      printf '%s\n' "local TLS rehearsal: could not stop scratch cluster; retained ${TEMPORARY_DIRECTORY}" >&2
      exit 1
    fi
  fi
  find "${TEMPORARY_DIRECTORY}" -depth -delete
  exit "${exit_status}"
}
trap cleanup EXIT

wait_for_setting() {
  local name="$1" expected="$2" actual
  for _ in {1..20}; do
    actual="$("${psql[@]}" -Atc "SHOW ${name}" 2>/dev/null || true)"
    [[ "${actual}" == "${expected}" ]] && return 0
    sleep 0.1
  done
  return 1
}

tls_client() {
  local expected_hostname="$1" ca_file="$2"
  "${OPENSSL_BIN}" s_client -starttls postgres -connect "127.0.0.1:${PORT}" \
    -servername "${PRIVATE_FQDN}" -verify_hostname "${expected_hostname}" \
    -verify_return_error -CAfile "${ca_file}" </dev/null >/dev/null 2>&1
}

for executable in initdb pg_ctl psql; do
  [[ -x "${POSTGRES_BIN}/${executable}" ]] || fail "missing ${POSTGRES_BIN}/${executable}"
done
[[ -x "${OPENSSL_BIN}" ]] || fail "missing ${OPENSSL_BIN}"

mkdir -m 0700 "${SOCKET_DIRECTORY}" "${CERTIFICATE_DIRECTORY}"
"${POSTGRES_BIN}/initdb" -D "${TEMPORARY_DIRECTORY}/data" -A trust -U tls_harness_admin --no-locale --encoding=UTF8 >/dev/null
"${POSTGRES_BIN}/pg_ctl" -D "${TEMPORARY_DIRECTORY}/data" \
  -o "-k '${SOCKET_DIRECTORY}' -h '127.0.0.1' -p ${PORT}" -l "${TEMPORARY_DIRECTORY}/postgres.log" start >/dev/null
postgres_started=1
psql=("${POSTGRES_BIN}/psql" -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse -h "${SOCKET_DIRECTORY}" -p "${PORT}" -U tls_harness_admin -d postgres)

[[ "$("${psql[@]}" -Atc 'SHOW listen_addresses')" == '127.0.0.1' ]] || fail 'scratch PostgreSQL is not loopback-only'
[[ "$("${psql[@]}" -Atc 'SHOW ssl')" == 'off' ]] || fail 'scratch PostgreSQL did not start with TLS off'
if "${OPENSSL_BIN}" s_client -starttls postgres -connect "127.0.0.1:${PORT}" </dev/null >/dev/null 2>&1; then
  fail 'scratch PostgreSQL accepted STARTTLS while ssl is off'
fi

"${OPENSSL_BIN}" genrsa -out "${CERTIFICATE_DIRECTORY}/ca.key" 2048 >/dev/null 2>&1
"${OPENSSL_BIN}" req -x509 -new -sha256 -days 1 -key "${CERTIFICATE_DIRECTORY}/ca.key" \
  -subj '/CN=Baci local TLS rehearsal CA' -out "${CERTIFICATE_DIRECTORY}/ca.crt" >/dev/null 2>&1
"${OPENSSL_BIN}" genrsa -out "${CERTIFICATE_DIRECTORY}/server.key" 2048 >/dev/null 2>&1
"${OPENSSL_BIN}" req -new -key "${CERTIFICATE_DIRECTORY}/server.key" -subj "/CN=${PRIVATE_FQDN}" \
  -out "${CERTIFICATE_DIRECTORY}/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "${PRIVATE_FQDN}" > "${CERTIFICATE_DIRECTORY}/server.ext"
"${OPENSSL_BIN}" x509 -req -sha256 -days 1 -in "${CERTIFICATE_DIRECTORY}/server.csr" \
  -CA "${CERTIFICATE_DIRECTORY}/ca.crt" -CAkey "${CERTIFICATE_DIRECTORY}/ca.key" -CAcreateserial \
  -extfile "${CERTIFICATE_DIRECTORY}/server.ext" -out "${CERTIFICATE_DIRECTORY}/server.crt" >/dev/null 2>&1
"${OPENSSL_BIN}" genrsa -out "${CERTIFICATE_DIRECTORY}/wrong-ca.key" 2048 >/dev/null 2>&1
"${OPENSSL_BIN}" req -x509 -new -sha256 -days 1 -key "${CERTIFICATE_DIRECTORY}/wrong-ca.key" \
  -subj '/CN=Baci local TLS rehearsal wrong CA' -out "${CERTIFICATE_DIRECTORY}/wrong-ca.crt" >/dev/null 2>&1
chmod 0600 "${CERTIFICATE_DIRECTORY}/server.key"

"${psql[@]}" -c "ALTER SYSTEM SET ssl = 'on'" >/dev/null
"${psql[@]}" -c "ALTER SYSTEM SET ssl_cert_file = '${CERTIFICATE_DIRECTORY}/server.crt'" >/dev/null
"${psql[@]}" -c "ALTER SYSTEM SET ssl_key_file = '${CERTIFICATE_DIRECTORY}/server.key'" >/dev/null
"${psql[@]}" -c 'SELECT pg_catalog.pg_reload_conf()' >/dev/null
wait_for_setting ssl on || fail 'ALTER SYSTEM reload did not enable TLS'
[[ "$("${psql[@]}" -Atc 'SHOW ssl_cert_file')" == "${CERTIFICATE_DIRECTORY}/server.crt" ]] || fail 'certificate setting did not persist'
[[ "$("${psql[@]}" -Atc 'SHOW ssl_key_file')" == "${CERTIFICATE_DIRECTORY}/server.key" ]] || fail 'key setting did not persist'
tls_client "${PRIVATE_FQDN}" "${CERTIFICATE_DIRECTORY}/ca.crt" || fail 'trusted TLS handshake or hostname verification failed'
if tls_client 'wrong.piggyvest-db.staging.baci.internal' "${CERTIFICATE_DIRECTORY}/ca.crt"; then
  fail 'TLS accepted the wrong hostname'
fi
if tls_client "${PRIVATE_FQDN}" "${CERTIFICATE_DIRECTORY}/wrong-ca.crt"; then
  fail 'TLS accepted an untrusted CA'
fi

"${psql[@]}" -c "ALTER SYSTEM SET ssl = 'off'" >/dev/null
"${psql[@]}" -c "ALTER SYSTEM SET ssl_cert_file = ''" >/dev/null
"${psql[@]}" -c "ALTER SYSTEM SET ssl_key_file = ''" >/dev/null
"${psql[@]}" -c 'SELECT pg_catalog.pg_reload_conf()' >/dev/null
wait_for_setting ssl off || fail 'ALTER SYSTEM reload did not restore TLS off'
[[ -z "$("${psql[@]}" -Atc 'SHOW ssl_cert_file')" ]] || fail 'certificate setting did not restore empty'
[[ -z "$("${psql[@]}" -Atc 'SHOW ssl_key_file')" ]] || fail 'key setting did not restore empty'
if tls_client "${PRIVATE_FQDN}" "${CERTIFICATE_DIRECTORY}/ca.crt"; then
  fail 'TLS remained available after restoring ssl off'
fi

printf '%s\n' "local TLS rehearsal passed on 127.0.0.1:${PORT}"
