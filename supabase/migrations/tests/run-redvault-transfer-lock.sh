#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_redvault_lock_$$"
created=false
cleanup() { if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/redvault_transfer_lock_fixture.sql" -f "$root/supabase/migrations/20261101095605_redvault_transfer_source_quantity.sql" -f "$root/supabase/migrations/20261101154438_redvault_inventory_trigger_nonblocking_parent_lock.sql" -c 'CREATE TRIGGER redvault_transfer AFTER UPDATE ON public.variant_inventory FOR EACH ROW EXECUTE FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory()' -f "$root/supabase/migrations/tests/redvault_transfer_lock_assert.sql"
echo 'PASS redvault transfer lock'
