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
pilot_policy="$root/supabase/migrations/20260928120000_uba_redvault_private_pilot_policy.sql"
pilot_order_guard="$root/supabase/migrations/20260928120500_uba_redvault_private_pilot_order_guard.sql"
pilot_attempt_guards="$root/supabase/migrations/20260928121000_uba_redvault_private_pilot_attempt_guards.sql"
pilot_rpc_wrappers="$root/supabase/migrations/20260928121500_uba_redvault_private_pilot_rpc_wrappers.sql"
pilot_fulfillment_guards="$root/supabase/migrations/20260928122000_uba_redvault_private_pilot_fulfillment_guards.sql"
legacy_and_shipment="$root/supabase/migrations/20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql"
review_followups="$root/supabase/migrations/20261006120100_uba_redvault_pilot_review_followups.sql"
permit_completion="$root/supabase/migrations/20261006130000_uba_redvault_pilot_permit_payment_completion.sql"
product_boundary="$root/supabase/migrations/20261006140000_uba_redvault_pilot_product_boundary.sql"
binding_guards="$root/supabase/migrations/20261006150000_uba_redvault_pilot_binding_and_cancel_guards.sql"
activation_lock="$root/supabase/migrations/20261006160000_uba_redvault_pilot_activation_lock_and_policy_indexes.sql"
reserve_lock_order="$root/supabase/migrations/20261006170000_uba_redvault_pilot_reserve_lock_order.sql"
savings_and_expiry="$root/supabase/migrations/20261006180000_uba_redvault_pilot_savings_and_expiry_guards.sql"
preserve_binding="$root/supabase/migrations/20261006190000_uba_redvault_pilot_preserve_binding_after_disable.sql"
preserved_shipment_savings="$root/supabase/migrations/20261006190100_uba_redvault_pilot_preserved_binding_shipment_savings.sql"
staging_passthrough="$root/supabase/migrations/20261006190200_uba_redvault_pilot_disabled_policy_staging_passthrough.sql"
item_fulfillment="$root/supabase/migrations/20261006190300_uba_redvault_pilot_item_fulfillment_guard.sql"
db_staging_mode="$root/supabase/migrations/20261006190400_uba_redvault_pilot_db_staging_mode.sql"
bound_product_immutable="$root/supabase/migrations/20261006190500_uba_redvault_pilot_bound_product_immutable.sql"
reenable_tracking="$root/supabase/migrations/20261006190600_uba_redvault_pilot_reenable_and_tracking_guard.sql"
eligibility_guard="$root/supabase/migrations/20261006190700_uba_redvault_pilot_product_eligibility_guard.sql"
atomic_publish="$root/supabase/migrations/20261006190800_uba_redvault_pilot_atomic_activation_publish.sql"
require_active="$root/supabase/migrations/20261006190900_uba_redvault_pilot_require_active_product.sql"
lock_before_activation="$root/supabase/migrations/20261006191000_uba_redvault_pilot_lock_product_before_activation.sql"
order_variant_recheck="$root/supabase/migrations/20261006191100_uba_redvault_pilot_order_variant_recheck.sql"
order_status_recheck="$root/supabase/migrations/20261006191200_uba_redvault_pilot_order_status_recheck.sql"
test_setup="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-setup.sql"
test_staging="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-staging.sql"
test_reservations="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-reservations.sql"
test_postreserve="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-postreserve.sql"
test_fulfillment="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-fulfillment.sql"
test_winddown="$root/supabase/migrations/tests/redvault-private-pilot-full-schema-winddown.sql"

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
  cat "$fixed_five" "$pilot_policy" "$pilot_order_guard" "$pilot_attempt_guards" "$pilot_rpc_wrappers" "$pilot_fulfillment_guards" "$legacy_and_shipment" "$review_followups" "$permit_completion" "$product_boundary" "$binding_guards"
  # This runner concatenates every migration into one transaction, so the
  # policy seed row's deferred reservation check is still pending when the
  # follow-up indexes are created. Production applies each migration in its
  # own transaction; fire just that check, create the indexes, then restore
  # deferred mode so the reservation flow keeps working below.
  printf 'SET CONSTRAINTS private.uba_redvault_live_pilot_policy_reserved_attempt_id_fkey IMMEDIATE;\n'
  cat "$activation_lock"
  printf 'SET CONSTRAINTS private.uba_redvault_live_pilot_policy_reserved_attempt_id_fkey DEFERRED;\n'
  cat "$reserve_lock_order" "$savings_and_expiry" "$preserve_binding" "$preserved_shipment_savings" "$staging_passthrough" "$item_fulfillment" "$db_staging_mode" "$bound_product_immutable" "$reenable_tracking" "$eligibility_guard" "$atomic_publish" "$require_active" "$lock_before_activation" "$order_variant_recheck" "$order_status_recheck"
  cat "$test_setup" "$test_staging" "$test_reservations" "$test_postreserve" "$test_fulfillment" "$test_winddown"
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
