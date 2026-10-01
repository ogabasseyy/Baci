import { ADMIN_PLATFORM_REPAIR_PENDING_SOURCES } from './expected-admin-platform-repair-pending-sources.test-support';

export const ADMIN_PLATFORM_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260805150000_platform_admin_rbac.sql',
    sha256: 'e17bef7ebb23a4a9075af17ec9fd74dbd399a498b0654ae669a050c5f88f019a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150010_repair_admin_platform_analytics.sql',
    sha256: '20a002efac9f47ac8b0a93c97a80b1cbf0fd0476bcfca33425c6415be8bd9f3d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150011_repair_admin_platform_analytics_breakdowns.sql',
    sha256: 'ac96223400e655ecc7b30998d57da0735dea5b74bbd8c2f7add19907bc7ee620',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150012_repair_admin_platform_analytics_merchants.sql',
    sha256: 'cd4b133ec0be63dc02d33a980d48afbfe422cc7e41e35bb20e00566a4f940919',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150013_repair_admin_platform_analytics_rpc.sql',
    sha256: '173bca2089bf83a6fcb1134c85d4d0455d2dc639aeb27464474071f62c9a087f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150020_repair_admin_merchant_sales_activity.sql',
    sha256: 'd24fa0fcd0493f78b5032d1565ea370253b2ed499e61b5c873eef7d7e3bcc934',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150100_admin_reconciliation_read_model.sql',
    sha256: '974fed3308334b34d04272615d475079b1741841f1efe0fa5f4f27fa4eb6dc23',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150200_admin_operations_read_model.sql',
    sha256: '392436f731fad7270003c1ef655f184beed9b3ec4cd9c0bd2c3ba11b5206f0b7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150300_platform_audit_events.sql',
    sha256: '92ec39f4e51f893d5ba9821718479425f8a3bc0901194ce709678ec958ca3170',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150301_platform_audit_event_writers.sql',
    sha256: 'bb5ed19369e35ec9eb79eb6dad3849b6e9c662c31e0e168ab8d3fbd9bb8dc93c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150302_platform_audit_event_reader.sql',
    sha256: 'f6fda9bd990f0e48361d84d5b77e31d5490b3cdaee3e3cf7b0ea1f7ae6c9cb9d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150310_platform_audit_reader_indexes.sql',
    sha256: '86d082932e83fb7175dc4941847c4183b7ae7e633d023940ffbd70a01306414f',
  },
  {
    repositoryPath: 'supabase/migrations/20260805150400_admin_merchant_360.sql',
    sha256: 'bd12feaa135cc24308d31350e2938e03fde80682eb36884cc7ee4670dd977f6a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150500_admin_notifications_repairs.sql',
    sha256: '97bf4ddc7a59e1f19a271fb1fe9bb8e30778c636437f3b5c2f829b7bbcf08f48',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150510_admin_notification_read_and_recipient_rpcs.sql',
    sha256: 'e14063a4d472fb7a73b591c1d3802dc18dd9a32d832e701759602fe933132881',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150520_admin_notification_scheduled_delivery_rpcs.sql',
    sha256: '4b4e1317a197c18f38b30593610ee4b15bc856b1b06b5981e7c3145ef92f85a8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150600_admin_reconciliation_export_audit.sql',
    sha256: '44af22a4a12518684d7d5265262f49c8ca055cbf411d3e8eb1634049f9bc58d4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150700_platform_admin_membership_management_list.sql',
    sha256: 'c92f100540a06f455189a37f14d61b99deebad401e14555a40a3c1fabcbbcee2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150710_platform_admin_membership_management_upsert.sql',
    sha256: 'ed669475ace1a37cfc1746b6f76115f0da97d18d74c4ec2d53c5fcde3d0c6041',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150720_platform_admin_membership_management_revoke.sql',
    sha256: 'efcc58b9ba2374c63ba433f302a8acfbc0cb32e700687b00c0512ad3f9272cfd',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150800_platform_admin_public_read_models.sql',
    sha256: '843a654558bb1bed6db6c455f15126744da98a45f71bbe99ed50d5b9293143b6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150900_harden_notification_rbac_and_realtime.sql',
    sha256: '7f2be6e0f91e1d9e02700d38d124fb4dc802f3b49685252d6ee40e5e69a2216a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805150950_platform_admin_mutation_audit_triggers.sql',
    sha256: '494d6b83cf4d774461d38fa5e7a1382792d0468a82a2716822c6a5f1b28de755',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151000_admin_system_health_read_model.sql',
    sha256: '721dfe3f070e5ce4316dacf98b9a0684dbb255afc56c84f19bd07edbc2ab7137',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151100_admin_notifications_concurrent_indexes.sql',
    sha256: '6d77d396fc0628f845ea00526363baed154848698c4678d7bc2ee1bca898aea1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151200_harden_admin_operations_rbac.sql',
    sha256: 'e0040f01021502a8b9078d1fe672a4694d9514b41fda898450506aae5bd83d0b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151210_validate_admin_notification_targets.sql',
    sha256: '88f619fff58749ff67432a3b3e51ef5e9041803ae64e73beddf7675f1095b6a1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
    sha256: '781a65f02b95f85f20597ef3c93e5941caa16fb456dca1ca3da3d2c5336c55bc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151310_claim_scheduled_admin_notification_delivery.sql',
    sha256: '2201e18ce3903fb7090fb8aa60a14b12ddfc919257960be8588ce0dd5f58b4c3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151320_schedule_scheduled_admin_notification_worker.sql',
    sha256: 'abff06781555cd9efc81acd11366305a82ac334520a7572f27bedebcba4dcaaa',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151330_harden_admin_notification_recipient_delivery.sql',
    sha256: '5130e29ddb47a1bb36ec091437a0a5ccef09e0e365b44f342d1c7c6c789c01e1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151350_repair_admin_platform_order_counts.sql',
    sha256: '46da637f7c0f2cd499445739ca82f7ebc0f7c092ee0473d8c4d4b9962ae39eee',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151360_harden_merchant_notification_table_privileges.sql',
    sha256: 'd177b6c5afb9cad4df2c01b2924b2fffe9d2ec7cf79c8c80fd65079d83b3a312',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151370_mark_all_visible_merchant_notifications_read.sql',
    sha256: 'a60fd4d48ddf2c13b1d1853bb7a43c34a2979e1248e2f05c1289869f22efcc80',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151380_repair_admin_system_health_definitions.sql',
    sha256: '747ccdaf8e3e08e122f0cec2cc5ecd9e783b88fb5ad91646370a052cf2e3f24a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151390_repair_admin_merchant_360_money_truth.sql',
    sha256: '35addb6dc2ed6dded2878a1861e6a7b70964f9f662ae67e724a4a2e640298006',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151400_paginate_admin_merchant_directory.sql',
    sha256: '1dede6a3843c6bee763115466a68666cd865669a067d4281bb1899f414ead9ae',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151420_harden_admin_event_pipeline_read_models.sql',
    sha256: 'd0396c219bb1513a254980b31e0d40f3b2854dafe2d0c47537b2350d8d50d978',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151440_harden_platform_settings_secret_access.sql',
    sha256: 'acbe495b7feab4916c70b057fe9f2fde7fb9dd23920878f1c794a25e6d6c95e4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151450_harden_admin_notification_table_access.sql',
    sha256: '612a9bde545bc3d96dcb316fea63e2c393751807d7ac07871d2cacce02daef26',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151460_page_scheduled_notification_audiences.sql',
    sha256: '23332d423804134410febd0f988aeb7ef8d5d1b4880146adcbf8cb6fbeb6e4ff',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151470_claim_bound_notification_recipient_batches.sql',
    sha256: '4880ed0b62da53ca1eeb1612fc19fba1a3b0207ae3374e28f2614092a3e03b6d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151480_signal_finalized_notification_recipients.sql',
    sha256: '63f8d876fc1c0ff671c19cf1e6db75fb19f0357d42c458f55ef8d8f88341f78a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151490_platform_content_rbac_bridge.sql',
    sha256: '6ce56db33f18edc14ca8043c49d632f3d07810904d54333de23353ce8f1f9904',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151500_fail_closed_merchant_payout_requests.sql',
    sha256: '02389c7468ce532b46c9903057d58c91932018ebb04ae8f90f9814df8aaa52e6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151510_repair_admin_reconciliation_currency_truth.sql',
    sha256: 'a42ec7da2727b670362ae54e64cb35b61d971ce90a9819ce9adc68769d82f192',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151511_repair_admin_merchant_360_processing_settlements.sql',
    sha256: 'beb315fb9903fb31a8993a2fae3491ecc02016b8698165cb5edd5f38c7c0048f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151512_document_admin_analytics_order_created_time_basis.sql',
    sha256: 'e2f13265cca9baad56e821f2bf15b5747ecb8267beb86ab82bddd58e1ae8b541',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151513_withhold_currencyless_reconciliation_items.sql',
    sha256: 'b1eedfb1628747fc45c805972a0779422bcbef00ceb808545facaebfaf0c6c06',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151550_harden_merchant_wallet_rpc_permissions.sql',
    sha256: '1c84ae5c614cdc56c574169fc0d31dbad9b536b4dc2be9962b612ead2bf97910',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151570_harden_admin_error_code_projections.sql',
    sha256: '99a3f434efdb3f49513d99522d34a9405d58cdbde55b0a70b6653ee8e055900e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151600_snapshot_notification_audiences_and_leases.sql',
    sha256: '89fe0c43b79d0a3375d854eb10794262b9219a2655cf7c1126aea3fa928596c6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151610_close_notification_target_oracle.sql',
    sha256: 'ffc21f7b7f2a376e08e37fa3c33c418438455bf902e681270922948e21bd1504',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151620_notification_push_outbox.sql',
    sha256: 'd74a5ed4b4d423d0efd8fd2d8eb9c184c5fe273680b4a162c0b93ee8fcc09cdf',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151630_notification_worker_health.sql',
    sha256: '98c0deb15f2521224c300cb81bfcdef54b7e50b3f081a6eaff77d042b7f4b655',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151640_harden_notification_leases_push_results_and_health.sql',
    sha256: '21a8dd1398da0276621890b293a9cac180c4085b7d1a9f3a1b079f8a12a8ba7f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151650_preserve_dual_role_notification_merchants.sql',
    sha256: 'bf985aa46f2a8eb37dbd19eff28f3f9bc00e56c6e3f10248d1809d30f21e56e1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805151660_retire_legacy_admin_merchant_health_rpc.sql',
    sha256: 'e0bd04ca14ec98db9f6e3657192c8e8f62d3dcd47212d1f2f2ea06a0713b849d',
  },
  ...ADMIN_PLATFORM_REPAIR_PENDING_SOURCES,
] as const;
