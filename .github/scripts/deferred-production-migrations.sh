#!/usr/bin/env bash

# Migrations listed here install database enforcement or hash semantics that
# depend on the matching application revision already serving traffic. The
# pre-deploy phase skips them; the deploy job applies them immediately after the
# new revision is live. Keep this list explicit and short so unrelated schema
# migrations still run before application deployment.
is_postdeploy_migration() {
  case "$1" in
    20260827140000_enforce_storefront_order_delivery_metadata|20260828091000_harden_storefront_order_rpc_context_and_replays|20260828101000_allow_legacy_quiz_award_order_context|20260828110000_prepare_storefront_order_hash_stamping|20260828110100_finalize_storefront_order_hash_stamping|20260828120000_enforce_storefront_order_replay_route_context|20260828130000_scope_storefront_order_replay_route_context|20260828151000_enforce_storefront_airport_pickup_location|20260828190000_restore_storefront_order_delivery_metadata_enforcement)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# These migrations replace a live pending-order trigger. They must be sent in
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
    *)
      return 1
      ;;
  esac
}
