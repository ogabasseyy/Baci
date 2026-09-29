#!/bin/sh
set -eu

container=supabase_db_baci-redvault-local
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
fixed_five="$root/supabase/migrations/20260928110000_uba_redvault_fixed_five_percent.sql"
existing_binding_fixed_five="$root/supabase/migrations/20260928105900_uba_redvault_existing_binding_five_percent.sql"
binding_fixture="$root/supabase/migrations/tests/redvault-existing-binding-fixed-five-setup.sql"
binding_converted="$root/supabase/migrations/tests/redvault-existing-binding-fixed-five-converted.sql"
binding_five="$root/supabase/migrations/tests/redvault-existing-binding-fixed-five-bound-five.sql"
binding_none="$root/supabase/migrations/tests/redvault-existing-binding-fixed-five-no-binding.sql"
pilot="$root/supabase/migrations/20260928120000_uba_redvault_private_live_pilot.sql"
legacy_and_shipment="$root/supabase/migrations/20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql"
test_sql="$root/supabase/migrations/tests/redvault-private-pilot-full-schema.sql"

if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" != true ]; then
  printf 'Required local database container is not running: %s\n' "$container" >&2
  exit 2
fi

{
  printf 'BEGIN;\n'
  printf "SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s';\n"
  cat <<'SQL'
DO $$ BEGIN
  IF to_regclass('private.uba_redvault_live_pilot_policy') IS NOT NULL THEN
    RAISE EXCEPTION 'pilot_policy_exists_before_transactional_migration_test';
  END IF;
END $$;
SQL
  cat "$binding_fixture" "$existing_binding_fixed_five" "$binding_converted"
  cat "$existing_binding_fixed_five" "$binding_five"
  cat "$existing_binding_fixed_five" "$binding_none"
  cat "$fixed_five" "$pilot" "$legacy_and_shipment"
  sed '1{/^BEGIN;$/d;}' "$test_sql"
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
