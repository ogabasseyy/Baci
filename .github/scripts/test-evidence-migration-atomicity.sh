#!/usr/bin/env bash

set -euo pipefail

script_dir="$1"
fixture_root="$2"
fake_bin="$3"
applier="$4"

# The production applier owns the transaction boundary for each ordinary
# migration. Verify the DVA evidence migration is inside the same boundary as
# its history insert, with no inner COMMIT before the ledger row.
evidence_atomicity_dir="$fixture_root/evidence-atomicity"
mkdir -p "$evidence_atomicity_dir"
cp \
  "$script_dir/../../supabase/migrations/20261106194000_agentic_dva_provider_success_evidence.sql" \
  "$evidence_atomicity_dir/20261106194000_agentic_dva_provider_success_evidence.sql"
evidence_atomicity_log="$fixture_root/evidence-atomicity-queries.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$evidence_atomicity_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$evidence_atomicity_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$fixture_root/evidence-atomicity-output.log"
jq -er \
  'select(.query | contains("CREATE ROLE agentic_dva_provider_evidence_writer")) | .query' \
  "$evidence_atomicity_log" >"$fixture_root/evidence-atomicity-query.sql"
test "$(head -n 1 "$fixture_root/evidence-atomicity-query.sql")" = 'BEGIN;'
test "$(grep -c '^BEGIN;$' "$fixture_root/evidence-atomicity-query.sql")" -eq 1
test "$(grep -c '^COMMIT;$' "$fixture_root/evidence-atomicity-query.sql")" -eq 1
evidence_registration_line="$(grep -n 'INSERT INTO supabase_migrations.schema_migrations' "$fixture_root/evidence-atomicity-query.sql" | cut -d: -f1)"
evidence_commit_line="$(grep -n '^COMMIT;$' "$fixture_root/evidence-atomicity-query.sql" | cut -d: -f1)"
if [ -z "$evidence_registration_line" ] || [ "$evidence_registration_line" -ge "$evidence_commit_line" ]; then
  echo 'DVA evidence migration history must be recorded before the production transaction commits' >&2
  exit 1
fi

# The dormant post-logout finalizer migration must also be sent through the
# production applier as one transaction with its history registration.
finalizer_atomicity_dir="$fixture_root/finalizer-atomicity"
mkdir -p "$finalizer_atomicity_dir"
cp \
  "$script_dir/../../supabase/migrations/20261107103000_agentic_dva_postlogout_finalizer.sql" \
  "$finalizer_atomicity_dir/20261107103000_agentic_dva_postlogout_finalizer.sql"
finalizer_atomicity_log="$fixture_root/finalizer-atomicity-queries.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$finalizer_atomicity_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$finalizer_atomicity_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$fixture_root/finalizer-atomicity-output.log"
jq -er \
  'select(.query | contains("CREATE ROLE agentic_dva_finalizer")) | .query' \
  "$finalizer_atomicity_log" >"$fixture_root/finalizer-atomicity-query.sql"
test "$(head -n 1 "$fixture_root/finalizer-atomicity-query.sql")" = 'BEGIN;'
test "$(grep -c '^BEGIN;$' "$fixture_root/finalizer-atomicity-query.sql")" -eq 1
test "$(grep -c '^COMMIT;$' "$fixture_root/finalizer-atomicity-query.sql")" -eq 1
finalizer_registration_line="$(grep -n 'INSERT INTO supabase_migrations.schema_migrations' "$fixture_root/finalizer-atomicity-query.sql" | cut -d: -f1)"
finalizer_commit_line="$(grep -n '^COMMIT;$' "$fixture_root/finalizer-atomicity-query.sql" | cut -d: -f1)"
if [ -z "$finalizer_registration_line" ] || [ "$finalizer_registration_line" -ge "$finalizer_commit_line" ]; then
  echo 'Finalizer migration history must be recorded before the production transaction commits' >&2
  exit 1
fi

# Exercise the real applier's failure path with this exact migration. The
# failed Management API request contains the DDL and ledger insert together;
# the applier must stop after that failed atomic request.
finalizer_failure_log="$fixture_root/finalizer-atomicity-failure-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$finalizer_atomicity_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$finalizer_failure_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  FAKE_FAIL_NON_SELECT=1 \
  FAKE_ERROR_RESPONSE='{"message":"finalizer migration failed"}' \
  bash "$applier" >"$fixture_root/finalizer-atomicity-failure-output.log" 2>&1; then
  echo 'Expected the finalizer migration applier failure to stop before reporting success' >&2
  exit 1
fi
grep -q 'Response: {"message":"finalizer migration failed"}' \
  "$fixture_root/finalizer-atomicity-failure-output.log"
test "$(jq -c 'select(.query | startswith("SELECT version, name"))' "$finalizer_failure_log" | wc -l | tr -d ' ')" -eq 1
test "$(jq -c 'select(.query | contains("CREATE ROLE agentic_dva_finalizer"))' "$finalizer_failure_log" | wc -l | tr -d ' ')" -eq 1
if jq -e 'select(.query | startswith("INSERT INTO supabase_migrations.schema_migrations"))' \
  "$finalizer_failure_log" >/dev/null; then
  echo 'Finalizer history must never be submitted separately after its failed DDL request' >&2
  exit 1
fi
