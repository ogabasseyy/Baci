export const REPAIR_CASES = [
  {
    label: 'GIGL Realtime broadcast',
    historicalPath:
      'supabase/migrations/20260727220050_shipment_tracking_realtime_broadcast.sql',
    historicalSha256:
      '89b2dafdf9de92770d8a20151444a6c34602f78cb83bcc79cb20ed3ea9c21b65',
    repairPath:
      'supabase/migrations/20260803000600_repair_gigl_tracking_realtime_broadcast.sql',
    ordinal: 129,
  },
  {
    label: 'GIGL retry edges',
    historicalPath:
      'supabase/migrations/20260801141800_harden_gigl_tracking_retry_edges.sql',
    historicalSha256:
      '35bcfb114ccfdadbbb44f69b21b53dd91b8df7a9eaa875f364e3d22b354801d1',
    repairPath:
      'supabase/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql',
    ordinal: 129,
  },
  {
    label: 'GIGL failed-event recovery scope',
    historicalPath:
      'supabase/migrations/20260801141900_scope_gigl_recovery_to_failed_event.sql',
    historicalSha256:
      '972030071dbeea262fdd1ccc20f4f62c07c90299d00e5fd70335617c4dd9a91d',
    repairPath:
      'supabase/migrations/20260804000100_repair_gigl_failed_event_recovery_scope.sql',
    ordinal: 129,
  },
  {
    label: 'GIGL notification recovery edges',
    historicalPath:
      'supabase/migrations/20260801142000_harden_gigl_notification_recovery_edges.sql',
    historicalSha256:
      'b373ae3f70d7311004e7e4400c2b3a3c8534300e82ee01c2c9e0d3df2680b81e',
    repairPath:
      'supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql',
    ordinal: 129,
  },
  {
    label: 'GIGL manual failure status scope',
    historicalPath:
      'supabase/migrations/20260801142100_preserve_manual_gigl_failures_after_unknown_scans.sql',
    historicalSha256:
      'f97c32889ae2e733d881bd7d6672cd91337936326f55e205d717bb972398ea73',
    repairPath:
      'supabase/migrations/20260804000300_repair_gigl_manual_failure_status_scope.sql',
    ordinal: 129,
  },
  {
    label: 'GIGL monitor backfill join',
    historicalPath:
      'supabase/migrations/20260801142200_cleanup_unowned_gigl_monitor_backfill.sql',
    historicalSha256:
      '605a0d48a4f116e67ee626ff173b66c6c80cefa77ad606a3813aa1ea6deda62a',
    repairPath:
      'supabase/migrations/20260804000500_repair_gigl_monitor_backfill_join.sql',
    ordinal: 129,
  },
  {
    label: 'Paystack chat-order relationship',
    historicalPath:
      'supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql',
    historicalSha256:
      '210c24070e7295dcdec19e10d33dd456a1dbc24891812cc74b4bfddeff808456',
    repairPath:
      'supabase/migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql',
    ordinal: 129,
  },
  {
    label: 'Paystack manual reconciliation review contracts',
    historicalPath:
      'supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql',
    historicalSha256:
      '4ed01fb7657a37530a4bdb5de152b4bf869e4b2ddaf7bc04c29f7ca131207408',
    repairPath:
      'supabase/migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql',
    ordinal: 129,
  },
  {
    label: 'Quiz materialized final rankings',
    historicalPath:
      'supabase/migrations/20260812170000_quiz_materialized_final_rankings_v2.sql',
    historicalSha256:
      '1b3eec0aa6d442ab9f3a61149e0839a0cad6aab80ea567200c815b9e2c98dee5',
    repairPath:
      'supabase/migrations/20260814230000_repair_quiz_materialized_final_rankings_v2.sql',
    ordinal: 129,
  },
  {
    label: 'Quiz results deny-client policy',
    historicalPath:
      'supabase/migrations/20260812173500_quiz_event_results_v2_deny_client_policy.sql',
    historicalSha256:
      '2a1d2341ec3631c74b9d44043db1f67f80b51012a796aea6477231bedfab98ef',
    repairPath:
      'supabase/migrations/20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql',
    ordinal: 129,
  },
  {
    label: 'Private expense receipt cleanup capture',
    historicalPath:
      'supabase/migrations/20260815103000_capture_private_expense_receipt_cleanup.sql',
    historicalSha256:
      '64530e9b7d94d9e2f832a8464593af977cb0af18c727a1a1b54c62310550997b',
    repairPath:
      'supabase/migrations/20260815220000_repair_capture_private_expense_receipt_cleanup.sql',
    ordinal: 129,
  },
  {
    label: 'Shipping provider policy audit',
    historicalPath:
      'supabase/migrations/20260921100200_enforce_merchant_shipping_provider_policy.sql',
    historicalSha256:
      'c89fb79e44148fe68caf65d99aed81de7a1ffd0d42b6ff85fbd41d9d98eceda3',
    repairPath:
      'supabase/migrations/20260926130000_repair_shipping_provider_policy_audit.sql',
    ordinal: 129,
  },
] as const;
