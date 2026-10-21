#!/usr/bin/env bash

# Migrations listed here install database enforcement or hash semantics that
# depend on the matching application revision already serving traffic. The
# pre-deploy phase skips them; the deploy job applies them immediately after the
# new revision is live. Keep this list explicit and short so unrelated schema
# migrations still run before application deployment.
is_postdeploy_migration() {
  case "$1" in
    20260827140000_enforce_storefront_order_delivery_metadata|20260828091000_harden_storefront_order_rpc_context_and_replays|20260828101000_allow_legacy_quiz_award_order_context|20260828110000_prepare_storefront_order_hash_stamping|20260828110100_finalize_storefront_order_hash_stamping|20260828120000_enforce_storefront_order_replay_route_context|20260828130000_scope_storefront_order_replay_route_context|20260828151000_enforce_storefront_airport_pickup_location|20260828190000_restore_storefront_order_delivery_metadata_enforcement|20260930160100_verified_receipt_claim_redemption|20260930160200_preview_receipt_claim_document_kind|20260930160300_enable_manual_order_document_triggers|20261019000000_revoke_loyalty_resolver_anon_execute)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# These migrations replace live database contracts. They must be sent in
# one Management API transaction so the broad predecessor is never observable
# without its scoped replacement.
atomic_migration_group_next_base() {
  case "$1" in
    20260827140000_enforce_storefront_order_delivery_metadata)
      printf '%s\n' '20260828091000_harden_storefront_order_rpc_context_and_replays'
      ;;
    20260828091000_harden_storefront_order_rpc_context_and_replays)
      printf '%s\n' '20260828110000_prepare_storefront_order_hash_stamping'
      ;;
    20260828120000_enforce_storefront_order_replay_route_context)
      printf '%s\n' '20260828130000_scope_storefront_order_replay_route_context'
      ;;
    20260828110000_prepare_storefront_order_hash_stamping)
      printf '%s\n' '20260828110100_finalize_storefront_order_hash_stamping'
      ;;
    20260828160000_persist_quiz_reserved_order_delivery_metadata)
      printf '%s\n' '20260828160100_preserve_quiz_reserved_order_delivery_metadata'
      ;;
    20260828160100_preserve_quiz_reserved_order_delivery_metadata)
      printf '%s\n' '20260828160200_limit_quiz_reserved_order_delivery_validation_to_redemption'
      ;;
    20261002191000_guarded_discovery_metadata_update)
      printf '%s\n' '20261002222000_guard_discovery_research_source'
      ;;
    20261002222000_guard_discovery_research_source)
      printf '%s\n' '20261002233000_lossless_discovery_research_revision'
      ;;
    20261002233000_lossless_discovery_research_revision)
      printf '%s\n' '20261003021500_authorize_discovery_research_reader'
      ;;
    20261013213516_customer_checkout_shipping_recovery_context)
      printf '%s\n' '20261013213522_customer_checkout_shipping_recovery_confirmation'
      ;;
    20261013213522_customer_checkout_shipping_recovery_confirmation)
      printf '%s\n' '20261014080000_customer_checkout_shipping_recovery_scalar_address'
      ;;
    20261014080000_customer_checkout_shipping_recovery_scalar_address)
      printf '%s\n' '20261014120000_customer_checkout_shipping_recovery_review_followups'
      ;;
    20261014120000_customer_checkout_shipping_recovery_review_followups)
      printf '%s\n' '20261014130000_customer_checkout_shipping_recovery_hardening'
      ;;
    20261014130000_customer_checkout_shipping_recovery_hardening)
      printf '%s\n' '20261014140000_customer_checkout_shipping_recovery_confirm_hardening'
      ;;
    20261014140000_customer_checkout_shipping_recovery_confirm_hardening)
      printf '%s\n' '20261015115210_customer_checkout_shipping_recovery_acl_and_redaction_index'
      ;;
    20261015115210_customer_checkout_shipping_recovery_acl_and_redaction_index)
      printf '%s\n' '20261015124602_customer_checkout_shipping_recovery_address_aliases'
      ;;
    20261015124602_customer_checkout_shipping_recovery_address_aliases)
      printf '%s\n' '20261015130721_customer_checkout_shipping_recovery_delivery_boundary'
      ;;
    20261015130721_customer_checkout_shipping_recovery_delivery_boundary)
      printf '%s\n' '20261015145945_customer_checkout_shipping_recovery_committed_retry'
      ;;
    20261015145945_customer_checkout_shipping_recovery_committed_retry)
      printf '%s\n' '20261015215000_customer_checkout_shipping_recovery_activation_gate'
      ;;
    *)
      return 1
      ;;
  esac
}

# A historical prefix is refused by default. Only explicit reconciliation can
# upgrade the exact, fully applied ten-migration predecessor to its closed gate.
verify_checkout_recovery_migration_history() {
  local history="$1" directory="$2"
  local cursor='20261013213516_customer_checkout_shipping_recovery_context'
  local next recorded missing='' applied=0 present=0 total=0
  checkout_recovery_legacy_upgrade_required=0
  case "${CHECKOUT_RECOVERY_LEGACY_RECONCILIATION:-0}" in
    0|1) ;;
    *) echo '::error::invalid legacy recovery reconciliation approval' >&2; return 1 ;;
  esac
  while :; do
    total=$((total + 1))
    if [ -f "$directory/$cursor.sql" ]; then present=$((present + 1)); fi
    recorded="$(awk -F '\t' -v version="${cursor%%_*}" '$1 == version { print "recorded:" $2; exit }' <<<"$history")"
    if [ -n "$recorded" ]; then
      if [ "$recorded" != "recorded:${cursor#*_}" ]; then
        echo "::error::recovery migration identity mismatch: ${cursor%%_*}" >&2
        return 1
      fi
      applied=$((applied + 1))
    else
      missing="${missing}${cursor} "
    fi
    if ! next="$(atomic_migration_group_next_base "$cursor")"; then break; fi
    cursor="$next"
  done
  if [ "$applied" -gt 0 ] && [ "$applied" -ne "$total" ]; then
    if [ "${CHECKOUT_RECOVERY_LEGACY_RECONCILIATION:-0}" = 1 ] &&
      [ "$applied" -eq 10 ] && [ "$total" -eq 11 ] && [ "$present" -eq 11 ] &&
      [ "$missing" = '20261015215000_customer_checkout_shipping_recovery_activation_gate ' ]; then
      checkout_recovery_legacy_upgrade_required=1
    else
      echo "::error::partial recovery migration history ($applied/$total); reconcile before release" >&2
      return 1
    fi
  fi
  if [ "$present" -gt 0 ] && [ "$present" -ne "$total" ]; then
    echo "::error::incomplete recovery migration files ($present/$total); refusing RPC publication" >&2
    return 1
  fi
}
