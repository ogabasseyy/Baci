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
