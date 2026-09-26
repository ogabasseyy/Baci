#!/usr/bin/env bash

# The applier sources this exact source/repair/checksum mapping before it can
# register any historical migration. Each entry is immutable by checksum so a
# later edit cannot silently substitute a repair for different failed bytes.
historical_migration_repair_spec() {
  case "$1:$2" in
    20260727220050:shipment_tracking_realtime_broadcast)
      printf '%s\t%s\t%s\n' '20260803000600' 'repair_gigl_tracking_realtime_broadcast' '89b2dafdf9de92770d8a20151444a6c34602f78cb83bcc79cb20ed3ea9c21b65'
      ;;
    20260801141800:harden_gigl_tracking_retry_edges)
      printf '%s\t%s\t%s\n' '20260803000700' 'repair_gigl_tracking_retry_edges' '35bcfb114ccfdadbbb44f69b21b53dd91b8df7a9eaa875f364e3d22b354801d1'
      ;;
    20260801141900:scope_gigl_recovery_to_failed_event)
      printf '%s\t%s\t%s\n' '20260804000100' 'repair_gigl_failed_event_recovery_scope' '972030071dbeea262fdd1ccc20f4f62c07c90299d00e5fd70335617c4dd9a91d'
      ;;
    20260801142000:harden_gigl_notification_recovery_edges)
      printf '%s\t%s\t%s\n' '20260804000400' 'repair_gigl_notification_terminality_cardinality' 'b373ae3f70d7311004e7e4400c2b3a3c8534300e82ee01c2c9e0d3df2680b81e'
      ;;
    20260801142100:preserve_manual_gigl_failures_after_unknown_scans)
      printf '%s\t%s\t%s\n' '20260804000300' 'repair_gigl_manual_failure_status_scope' 'f97c32889ae2e733d881bd7d6672cd91337936326f55e205d717bb972398ea73'
      ;;
    20260801142200:cleanup_unowned_gigl_monitor_backfill)
      printf '%s\t%s\t%s\n' '20260804000500' 'repair_gigl_monitor_backfill_join' '605a0d48a4f116e67ee626ff173b66c6c80cefa77ad606a3813aa1ea6deda62a'
      ;;
    20260811135000:harden_paystack_chat_order_relationship)
      printf '%s\t%s\t%s\n' '20260813192730' 'repair_harden_paystack_chat_order_relationship' '210c24070e7295dcdec19e10d33dd456a1dbc24891812cc74b4bfddeff808456'
      ;;
    20260811140000:harden_paystack_manual_reconciliation_review_contracts)
      printf '%s\t%s\t%s\n' '20260814153213' 'repair_harden_paystack_manual_reconciliation_review_contracts' '4ed01fb7657a37530a4bdb5de152b4bf869e4b2ddaf7bc04c29f7ca131207408'
      ;;
    20260812170000:quiz_materialized_final_rankings_v2)
      printf '%s\t%s\t%s\n' '20260814230000' 'repair_quiz_materialized_final_rankings_v2' '1b3eec0aa6d442ab9f3a61149e0839a0cad6aab80ea567200c815b9e2c98dee5'
      ;;
    20260812173500:quiz_event_results_v2_deny_client_policy)
      printf '%s\t%s\t%s\n' '20260815000000' 'repair_quiz_event_results_v2_deny_client_policy' '2a1d2341ec3631c74b9d44043db1f67f80b51012a796aea6477231bedfab98ef'
      ;;
    20260815103000:capture_private_expense_receipt_cleanup)
      printf '%s\t%s\t%s\n' '20260815220000' 'repair_capture_private_expense_receipt_cleanup' '64530e9b7d94d9e2f832a8464593af977cb0af18c727a1a1b54c62310550997b'
      ;;
    20260921100200:enforce_merchant_shipping_provider_policy)
      printf '%s\t%s\t%s\n' '20260926130000' 'repair_shipping_provider_policy_audit' 'c89fb79e44148fe68caf65d99aed81de7a1ffd0d42b6ff85fbd41d9d98eceda3'
      ;;
    *) return 1 ;;
  esac
}

# An unpublished repair can itself be malformed. Keep it immutable and skip it
# only after the historical source and its corrected replacement are recorded.
historical_migration_repair_supersession_spec() {
  case "$1:$2" in
    20260804000200:repair_gigl_notification_recovery_edges)
      printf '%s\t%s\t%s\t%s\n' '20260801142000' 'harden_gigl_notification_recovery_edges' '20260804000400' 'repair_gigl_notification_terminality_cardinality'
      ;;
    *) return 1 ;;
  esac
}

historical_collision_repair_spec() {
  case "$1:$2" in
    20260615120000:customer_order_cancellation)
      printf '%s\t%s\n' '20260616205500' 'return_registered_push_token_id'
      ;;
    20260713130000:add_storefront_paystack_subaccount_configured_rpc)
      printf '%s\t%s\n' '20260713140000' 'quiz_finalize_rank_winners_reapply'
      ;;
    20260805090000:add_least_privilege_gigl_tracking_worker | \
    20260805090000:complete_merchant_invoice_partial_payments)
      printf '%s\t%s\n' '20260805090002' 'reapply_complete_merchant_invoice_partial_payment'
      ;;
    20260811120000:quiz_leaderboard_and_claim_projections_v2 | \
    20260811120000:allow_reviewed_paystack_email_mismatch)
      printf '%s\t%s\n' '20260813144355' 'reapply_allow_reviewed_paystack_email_mismatch'
      ;;
    *) return 1 ;;
  esac
}

historical_collision_version_is_known() {
  case "$1" in
    20260615120000 | 20260713130000 | 20260805090000 | 20260811120000) return 0 ;;
    *) return 1 ;;
  esac
}

historical_collision_name_is_valid() {
  case "$1:$2" in
    20260615120000:customer_order_cancellation | \
    20260615120000:register_push_token_rpc | \
    20260713130000:add_storefront_paystack_subaccount_configured_rpc | \
    20260713130000:quiz_finalize_rank_winners | \
    20260805090000:add_least_privilege_gigl_tracking_worker | \
    20260805090000:complete_merchant_invoice_partial_payments | \
    20260811120000:quiz_leaderboard_and_claim_projections_v2 | \
    20260811120000:allow_reviewed_paystack_email_mismatch)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

historical_name_alias_is_valid() {
  case "$1:$2:$3" in
    20260604132853:fix_storefront_order_customer_returning_id_ambiguity:fix_create_storefront_order_customer_returning_id_ambiguity)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
