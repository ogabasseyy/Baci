#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
applier="$script_dir/apply-pending-migrations.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_bin="$fixture_root/bin"
mkdir -p "$fake_bin"

cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

data_binary=''
while (($#)); do
  case "$1" in
    --data-binary)
      if (($# < 2)); then
        echo 'Expected a value for --data-binary' >&2
        exit 2
      fi
      data_binary="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ "$data_binary" != '@-' ]; then
  echo "Expected curl --data-binary @-, got ${data_binary:-<missing>}" >&2
  exit 2
fi

payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\n' "$FAKE_INITIAL_RESPONSE"
else
  if [ "${FAKE_FAIL_NON_SELECT:-0}" = '1' ]; then
    printf '%s\n' "$FAKE_ERROR_RESPONSE"
    exit 22
  fi
  printf '%s\n' '[]'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

# Above-max migrations defer (counted, never recorded); at-or-below-max
# apply normally. The deploy splits the applier around the GIGL hook
# restore so the reload canary is observed before the isolate grant.
capped_dir="$fixture_root/capped"
mkdir -p "$capped_dir"
printf '%s\n' "SELECT 'restore';" \
  >"$capped_dir/20260805113000_restore_gigl_tracking_postgrest_capability.sql"
printf '%s\n' "SELECT 'isolate';" \
  >"$capped_dir/20260805170000_isolate_gigl_tracking_postgrest_capability.sql"
capped_log="$fixture_root/capped-queries.log"
capped_output="$fixture_root/capped-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$capped_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$capped_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  MIGRATION_MAX_VERSION=20260805113000 \
  bash "$applier" >"$capped_output"

grep -q 'applied:         20260805113000  restore_gigl_tracking_postgrest_capability' "$capped_output"
grep -q 'deferred above MIGRATION_MAX_VERSION 20260805113000: 20260805170000  isolate_gigl_tracking_postgrest_capability' "$capped_output"
grep -q 'Migrations summary: 1 applied, 0 skipped, 1 deferred.' "$capped_output"
if grep -q '20260805170000' "$capped_log"; then
  echo 'Deferred migration SQL must not be sent to Supabase' >&2
  exit 1
fi

# A later uncapped run applies what the capped run deferred.
resume_log="$fixture_root/resume-queries.log"
resume_output="$fixture_root/resume-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$capped_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$resume_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260805113000","name":"restore_gigl_tracking_postgrest_capability"}]' \
  bash "$applier" >"$resume_output"
grep -q 'already applied: 20260805113000  restore_gigl_tracking_postgrest_capability' "$resume_output"
grep -q 'applied:         20260805170000  isolate_gigl_tracking_postgrest_capability' "$resume_output"

# The cap never splits an atomic group: a group reaching above it
# defers whole, then applies atomically once the cap lifts.
group_dir="$fixture_root/group"
mkdir -p "$group_dir"
printf '%s\n' "SELECT 'enforce';" \
  >"$group_dir/20260828120000_enforce_storefront_order_replay_route_context.sql"
printf '%s\n' "SELECT 'scope';" \
  >"$group_dir/20260828130000_scope_storefront_order_replay_route_context.sql"
group_log="$fixture_root/group-queries.log"
group_output="$fixture_root/group-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$group_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$group_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  MIGRATION_MAX_VERSION=20260828120000 \
  bash "$applier" >"$group_output"
grep -q '(atomic group)' "$group_output"
grep -q 'Migrations summary: 0 applied, 0 skipped, 2 deferred.' "$group_output"
if grep -q '20260828120000' "$group_log"; then
  echo 'Deferred atomic group SQL must not be sent to Supabase' >&2
  exit 1
fi

# Once the cap lifts, the deferred group applies atomically in one payload.
group_resume_log="$fixture_root/group-resume-queries.log"
group_resume_output="$fixture_root/group-resume-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$group_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$group_resume_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$group_resume_output"
grep -q 'applied:         20260828120000  enforce_storefront_order_replay_route_context' "$group_resume_output"
grep -q 'applied:         20260828130000  scope_storefront_order_replay_route_context' "$group_resume_output"
if [ "$(grep -c '^{' "$group_resume_log")" -ne 2 ]; then
  echo 'Expected the resumed atomic group to apply in a single payload' >&2
  exit 1
fi

# A malformed cap fails closed instead of applying an unknown prefix.
malformed_log="$fixture_root/malformed-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$capped_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$malformed_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  MIGRATION_MAX_VERSION=20260805 \
  bash "$applier" >"$fixture_root/malformed-output.log" 2>&1; then
  echo 'Expected a malformed MIGRATION_MAX_VERSION to fail closed' >&2
  exit 1
fi
grep -q 'MIGRATION_MAX_VERSION must be a 14-digit migration version' "$fixture_root/malformed-output.log"

echo 'MIGRATION_MAX_VERSION applier tests passed.'
