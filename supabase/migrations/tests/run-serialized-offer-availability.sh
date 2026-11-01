#!/usr/bin/env bash
# Use a local disposable PostgreSQL server, never a production server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_availability_$$"
definitions="$(mktemp)"
created=false
cleanup() { rm -f "$definitions"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '
  /^CREATE OR REPLACE FUNCTION (private|public)\.get_public_serialized_variant_availability_counts\(/ { found++; printing=1 }
  printing { print }
  printing && /^\$\$;$/ { printing=0 }
  END { if (found != 2 || printing) exit 1 }
' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$definitions"
awk '
  /^CREATE OR REPLACE FUNCTION public\.get_storefront_offer_resolution\(/ { found++; printing=1 }
  printing { print }
  printing && /^\$\$;$/ { printing=0 }
  END { if (found != 1 || printing) exit 1 }
' "$root/supabase/migrations/20261020120000_storefront_offer_resolution_authority.sql" >> "$definitions"
# Load the real PDP function with validation deferred: the compact fixture
# lacks unrelated catalog tables, but the migration's source patch is checked.
echo 'SET check_function_bodies = off;' >> "$definitions"
awk '/^CREATE OR REPLACE FUNCTION private\.get_storefront_pdp_core_v2\(/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20261020130000_pdp_core_snapshot_effective_policy.sql" >> "$definitions"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/migrations/tests/serialized_offer_availability_fixture.sql" \
  -f "$definitions" \
  -f "$root/supabase/migrations/20261101170000_serialized_offer_availability.sql" \
  -f "$root/supabase/migrations/20261101171000_serialized_offer_pdp_availability.sql" \
  -f "$root/supabase/migrations/20261101175000_serialized_offer_pdp_snapshot.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_availability_assert.sql"
echo 'PASS serialized offer availability'
