#!/bin/bash
# Retry behaviour of 20261119130000_quiz_identity_email_lookup_index.sql on a
# scratch PostgreSQL: an interrupted concurrent build leaves an invalid index,
# and the migration must rebuild it instead of wedging on every retry.
set -euo pipefail
root="$PWD"
migration="$root/supabase/migrations/20261119130000_quiz_identity_email_lookup_index.sql"
index='public.idx_customers_merchant_quiz_normalized_email_all'
test_dir=$(mktemp -d /tmp/quiz-email-index.XXXXXX)
cleanup() {
  if [ -f "$test_dir/data/postmaster.pid" ]; then pg_ctl -D "$test_dir/data" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT
initdb -D "$test_dir/data" -U postgres --auth=trust --no-locale >/dev/null
pg_ctl -D "$test_dir/data" -o "-k $test_dir -p 55498 -c listen_addresses='' -c allow_system_table_mods=on" -w start >"$test_dir/server.log"
export PGHOST="$test_dir" PGPORT=55498 PGUSER=postgres PGDATABASE=postgres
run() { psql -Xq -v ON_ERROR_STOP=1 "$@"; }
index_oid() { psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT '$index'::regclass::oid"; }
mark_invalid() { run -c "UPDATE pg_catalog.pg_index SET $1 = false WHERE indexrelid = '$index'::regclass"; }

# Stand-ins with the shape the migration relies on: the customers columns it
# indexes and an IMMUTABLE normaliser of the same name and signature.
run -c "CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, email text, deleted_at timestamptz)"
run -c "CREATE FUNCTION public.quiz_normalize_email(p_email text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT pg_catalog.lower(pg_catalog.btrim(p_email))'"

# 1. Interrupted build (invalid): the retry replaces the artifact.
run -c "CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public.customers (merchant_id, public.quiz_normalize_email(email))"
mark_invalid indisvalid
invalid_oid=$(index_oid)
run -f "$migration"
rebuilt_oid=$(index_oid)
test "$invalid_oid" != "$rebuilt_oid"
run -f "$root/supabase/migrations/tests/quiz_identity_email_lookup_index.sql"

# 2. A valid index is kept as it is on a rerun.
run -f "$migration"
test "$rebuilt_oid" = "$(index_oid)"

# 3. Interrupted build (not ready): the retry replaces the artifact too.
mark_invalid indisready
run -f "$migration"
test "$rebuilt_oid" != "$(index_oid)"
run -f "$root/supabase/migrations/tests/quiz_identity_email_lookup_index.sql"

# 4. An invalid index of a different shape must never be dropped blindly.
run -c "DROP INDEX $index; CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public.customers (merchant_id)"
mark_invalid indisvalid
mismatch_oid=$(index_oid)
if run -f "$migration" >"$test_dir/mismatch.log" 2>&1; then
  echo 'Mismatched invalid index was not rejected' >&2
  exit 1
fi
grep -q 'does not match the expected definition' "$test_dir/mismatch.log"
test "$mismatch_oid" = "$(index_oid)"

# 5. A valid index of a different shape fails the final guard and is kept.
run -c "DROP INDEX $index; CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public.customers (merchant_id)"
if run -f "$migration" >"$test_dir/changed.log" 2>&1; then
  echo 'Changed valid index was not rejected' >&2
  exit 1
fi
grep -q 'missing, invalid or changed' "$test_dir/changed.log"
echo 'Quiz identity email lookup index retry checks passed'
