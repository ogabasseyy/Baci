#!/usr/bin/env bash
set -euo pipefail

unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE

DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DIRECTORY
readonly POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
readonly GRANTS="${DIRECTORY}/provisioner-grants.sql"
readonly ASSERTIONS="${DIRECTORY}/provisioner-grants.test.sql"
readonly ROLE='piggyvest_staging_provisioner'
readonly PASSWORD='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
TEMPORARY_DIRECTORY="$(mktemp -d /tmp/baci-piggyvest-provisioner-grants.XXXXXX)"
readonly TEMPORARY_DIRECTORY
readonly SOCKET_DIRECTORY="${TEMPORARY_DIRECTORY}/socket"
readonly PORT=55444

fail() {
  printf '%s\n' "provisioner-grants rehearsal: $*" >&2
  exit 1
}

cleanup() {
  if [[ -f "${TEMPORARY_DIRECTORY}/data/postmaster.pid" ]]; then
    "${POSTGRES_BIN}/pg_ctl" -D "${TEMPORARY_DIRECTORY}/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "${TEMPORARY_DIRECTORY}"
}
trap cleanup EXIT

for executable in initdb pg_ctl psql; do
  [[ -x "${POSTGRES_BIN}/${executable}" ]] || fail "missing ${POSTGRES_BIN}/${executable}"
done
[[ -f "${GRANTS}" && -f "${ASSERTIONS}" ]] || fail 'candidate SQL files are missing'

mkdir -m 0700 "${SOCKET_DIRECTORY}"
"${POSTGRES_BIN}/initdb" -D "${TEMPORARY_DIRECTORY}/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"${POSTGRES_BIN}/pg_ctl" -D "${TEMPORARY_DIRECTORY}/data" \
  -o "-k '${SOCKET_DIRECTORY}' -h '' -p ${PORT}" -l "${TEMPORARY_DIRECTORY}/postgres.log" start >/dev/null
psql=("${POSTGRES_BIN}/psql" -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse -h "${SOCKET_DIRECTORY}" -p "${PORT}" -U harness_admin -d postgres)

"${psql[@]}" <<'SQL' >/dev/null
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.provisioner_probe_table (id integer PRIMARY KEY);
CREATE SEQUENCE piggyvest_staging.provisioner_probe_sequence;
CREATE FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.prepare_provisioning_intent(uuid, uuid, uuid, uuid, text, bytea) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.claim_provisioning_intent(uuid, uuid, uuid, integer, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.record_provisioning_result(uuid, uuid, uuid, uuid, text, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.expire_provisioning_claim(uuid, uuid, uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.record_created_customer(uuid, uuid, uuid, uuid, text, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.read_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.observe_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.begin_provisioning_verification(uuid, uuid, uuid, uuid, uuid, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.confirm_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA piggyvest_staging FROM PUBLIC;
SQL

role_count() {
  "${psql[@]}" -Atc "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = '${ROLE}'"
}

apply_candidate() {
  { cat "${GRANTS}"; cat "${ASSERTIONS}"; printf '%s\n' 'COMMIT;'; } | "${psql[@]}" -v "provisioner_password=${PASSWORD}" >/dev/null
}

assert_candidate() {
  "${psql[@]}" -f "${ASSERTIONS}" >/dev/null
}

[[ "$(role_count)" == '0' ]] || fail 'provisioner role must be absent before the candidate runs'
apply_candidate
[[ "$(role_count)" == '1' ]] || fail 'candidate did not create the provisioner role'

"${psql[@]}" <<'SQL' >/dev/null
SET ROLE piggyvest_staging_provisioner;
SELECT piggyvest_staging.read_provisioning_recovery(NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text);
SELECT piggyvest_staging.observe_provisioning_recovery(NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text);
SELECT piggyvest_staging.begin_provisioning_verification(NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text);
SELECT piggyvest_staging.confirm_provisioning_recovery(NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text);
RESET ROLE;
SQL

"${psql[@]}" -c "GRANT USAGE ON SEQUENCE piggyvest_staging.provisioner_probe_sequence TO ${ROLE}" >/dev/null
if assert_candidate >"${TEMPORARY_DIRECTORY}/sequence-assertion.log" 2>&1; then
  fail 'assertions accepted direct sequence privilege'
fi
grep -Fq 'provisioner has direct object privilege' "${TEMPORARY_DIRECTORY}/sequence-assertion.log" || fail 'sequence privilege produced an unexpected assertion failure'
"${psql[@]}" -c "REVOKE ALL PRIVILEGES ON SEQUENCE piggyvest_staging.provisioner_probe_sequence FROM ${ROLE}" >/dev/null
assert_candidate

"${psql[@]}" -c "DROP OWNED BY ${ROLE}; DROP ROLE ${ROLE};" >/dev/null
[[ "$(role_count)" == '0' ]] || fail 'could not reset the committed provisioner role'
{ cat "${GRANTS}"; printf '%s\n' 'ROLLBACK;'; } | "${psql[@]}" -v "provisioner_password=${PASSWORD}" >/dev/null
[[ "$(role_count)" == '0' ]] || fail 'rolled-back candidate left the provisioner role behind'

printf '%s\n' 'provisioner grants local PostgreSQL rehearsal passed'
