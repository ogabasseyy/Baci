import { ADMIN_PLATFORM_PENDING_SOURCES } from './expected-admin-platform-pending-sources.test-support';
import { EXPECTED_CATALOG_CACHE_PENDING_SOURCES } from './expected-catalog-cache-pending-sources.test-support';
import { EXPECTED_EXPENSE_PENDING_SOURCES } from './expected-expense-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES } from './expected-gigl-tracking-hardening-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_PENDING_SOURCES } from './expected-gigl-tracking-pending-sources.test-support';
import { EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './expected-gigl-wallet-shipping-pending-sources.test-support';
import { EXPECTED_MERCHANT_INVOICE_PENDING_SOURCES } from './expected-merchant-invoice-pending-sources.test-support';
import { EXPECTED_MERCHANT_PAYMENT_PENDING_SOURCES } from './expected-merchant-payment-pending-sources.test-support';
import { EXPECTED_NEGOTIATION_PENDING_SOURCES } from './expected-negotiation-pending-sources.test-support';
import { EXPECTED_PAYSTACK_PENDING_SOURCES } from './expected-paystack-pending-sources.test-support';
import { AUDIT_PENDING_SOURCES } from './expected-pending-audit-sources.test-support';
import { PAYMENT_INGRESS_AND_PROVENANCE_PENDING_SOURCES } from './expected-pending-payment-ingress-sources.test-support';
import { EXPECTED_PENDING_TAIL_SOURCES } from './expected-pending-tail-sources.test-fixture';
import { EXPECTED_QUIZ_LIVE_PENDING_SOURCES } from './expected-quiz-live-pending-sources.test-support';
import { EXPECTED_REPAIR_PICKUP_PENDING_SOURCES } from './expected-repair-pickup-pending-sources.test-support';
import { EXPECTED_SEARCH_PENDING_SOURCES } from './expected-search-pending-sources.test-support';
import { EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES } from './expected-storefront-order-pending-sources.test-support';
import { ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES } from './order-notification-outbox-pending-sources.test-fixture';
import { RECENT_PENDING_SOURCES } from './recent-pending-sources.test-fixture';
import { REDVAULT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-redvault-pending-sources';

const REDVAULT_PENDING_SOURCES = REDVAULT_PENDING_REPLAY_SOURCE_ROWS.split(
  '\n'
).map((row) => {
  const [sha256, filename] = row.split(' ');
  return {
    repositoryPath: `supabase/migrations/${filename}`,
    sha256,
  };
});

export const EXPECTED_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260721093205_harden_paid_order_completion_and_side_effect_retries.sql',
    sha256: 'e8398b0b10a5e9d199707bcceb5835f865bfce85dd4732e9bc46fc4e13d16d29',
  },
  {
    repositoryPath:
      'supabase/migrations/20260721093206_merchant_order_cancellation_audit.sql',
    sha256: 'b36447107978f1612b0f158bbd3331f635bf8bd940ec0ff01545ecba765a753b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260721093207_order_cancellation_side_effect_claims.sql',
    sha256: '399dfc28247c2f3d3c720783eeb13c3376a1b207f7ea1095e66366e919f1e5ea',
  },
  {
    repositoryPath:
      'supabase/migrations/20260721140000_forward_harden_merchant_order_cancellation.sql',
    sha256: '46efbde5a4a1f241ad0bc829edac60ecbbee156187f5d4f7975f3b6aabb9693b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260721140100_forward_harden_cancellation_side_effects.sql',
    sha256: '1fa573e186b486ade1ae4bc628969a74c37ee01f850cf7ab4d60ac3a40fad8a8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260721150000_quiz_leaderboard_bounded_and_self.sql',
    sha256: '9e16adac5b0653fbd27814b5af40d5dd170d11da3ff852970ea47735b9451bbd',
  },
  {
    repositoryPath:
      'supabase/migrations/20260722150000_s1_merchants_authenticated_containment.sql',
    sha256: '3fdc876b7699184efe079f9d9412301eac3b893aefc193868baef6e9bb448d76',
  },
  ...EXPECTED_MERCHANT_PAYMENT_PENDING_SOURCES,
  ...ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260724160000_korapay_storefront_setting_default_off.sql',
    sha256: '76ccee1969b595892e70322b5957fe03b6df444952d9f1b6bb9c1e59ffc55556',
  },
  {
    repositoryPath:
      'supabase/migrations/20260725120000_guard_customer_dob_soft_delete.sql',
    sha256: 'c1e76853223a105701c2ef28c2a7a1211508af13a7b27d12393590454b36bcd8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260725164445_restore_merchant_owner_row_select_branch.sql',
    sha256: '9823a697f756bb2865a5de62d2a202d2bf348b284ead1d5cee9c6838a477ca27',
  },
  ...EXPECTED_CATALOG_CACHE_PENDING_SOURCES,
  ...EXPECTED_GIGL_TRACKING_PENDING_SOURCES.map(([filename, sha256]) => ({
    repositoryPath: `supabase/migrations/${filename}`,
    sha256,
  })),
  {
    repositoryPath:
      'supabase/migrations/20260728091958_provision_mobile_merchant_v2.sql',
    sha256: '9e4df9812810ef2c7e0659a238390d6c97222b2891454ba00740ddbff6cc6104',
  },
  {
    repositoryPath:
      'supabase/migrations/20260729100000_add_merchant_identity_verified_rpc.sql',
    sha256: '60be0be8990407b279108981c8c47815a90f8855a05a106d6a9024e23cb6998d',
  },
  ...EXPECTED_PENDING_TAIL_SOURCES.identity,
  ...RECENT_PENDING_SOURCES.slice(0, 1),
  ...AUDIT_PENDING_SOURCES,
  ...RECENT_PENDING_SOURCES.slice(1, 6),
  {
    repositoryPath:
      'supabase/migrations/20260730223000_fix_order_shipment_booking_lock_ambiguity.sql',
    sha256: '93d4855c6b4a778c91f78b50ea1b83b74c9786dc7d4e97a99c90b97924a71620',
  },
  ...PAYMENT_INGRESS_AND_PROVENANCE_PENDING_SOURCES.slice(0, 2),
  {
    repositoryPath:
      'supabase/migrations/20260731134500_fix_shipment_booking_lock_column_ambiguity.sql',
    sha256: '830515212cfa19d2aa38a5c33964ef5d06d149084c8fdd7054d7cc27d8653183',
  },
  ...EXPECTED_PENDING_TAIL_SOURCES.paymentIngressFoundation,
  ...EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES.slice(0, 3).map(
    ([filename, sha256]) => ({
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    })
  ),
  ...RECENT_PENDING_SOURCES.slice(6),
  ...PAYMENT_INGRESS_AND_PROVENANCE_PENDING_SOURCES.slice(3),
  ...EXPECTED_PENDING_TAIL_SOURCES.paymentWebhookEvidence,
  ...EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES.slice(3).map(
    ([filename, sha256]) => ({
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    })
  ),
  ...EXPECTED_PENDING_TAIL_SOURCES.storefrontSearchReadiness,
  ...EXPECTED_SEARCH_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260803120000_allow_safe_admin_order_item_append.sql',
    sha256: 'f2b640bac8c3f3d41158313bc910aec6de0058cf652c47f0595c635bd98ecee1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260804120000_restore_storefront_order_private_schema_usage.sql',
    sha256: '54feed9b89d28855d7d6f4bb83ea04d708f2d1e75c9cff814d6f49845d26e5bc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260804130000_harden_storefront_order_private_schema_boundary.sql',
    sha256: '7550dc0f84d9a15775bb2cd1d63679c3021cdcd44c2d0f837948d22d92f2e441',
  },
  {
    repositoryPath:
      'supabase/migrations/20260804140000_harden_authenticated_private_schema_delegates.sql',
    sha256: '62201972e14cbafc34feb0584697b92d402eea9c15890a6ec4bbcfc3d5c7e0c5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814124135_fix_storefront_pdp_preflight_relation_category.sql',
    sha256: '34d9b431e3d16cfac0765c43d4c62fc9cd4421d295636245594cb1e2a1f8b9e3',
  },
  ...EXPECTED_QUIZ_LIVE_PENDING_SOURCES,
  ...EXPECTED_MERCHANT_INVOICE_PENDING_SOURCES,
  ...EXPECTED_PAYSTACK_PENDING_SOURCES,
  ...ADMIN_PLATFORM_PENDING_SOURCES,
  ...EXPECTED_EXPENSE_PENDING_SOURCES,
  ...EXPECTED_NEGOTIATION_PENDING_SOURCES,
  ...EXPECTED_PENDING_TAIL_SOURCES.late,
  ...EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260823110000_harden_jumia_orphan_authorization_sweep.sql',
    sha256: '3afab9495b805517ee42d7492a9666a608ffba11172321a3a810a0cb1c597780',
  },
  {
    repositoryPath:
      'supabase/migrations/20260824230000_allow_jumia_view_credential_refresh.sql',
    sha256: '629f967ffa25a8f79c38387262007e184e6ccb99d9bf0ef40cf5e43940ca00fa',
  },
  {
    repositoryPath:
      'supabase/migrations/20260824230100_lock_each_jumia_orphan_shop.sql',
    sha256: '1cb9abb1ef1bd5b9026c44958c78ee8534be0fbc065076112d6f979ead65921e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000001_restore_jumia_manage_credential_rotation.sql',
    sha256: 'af3fa5a276348e8ec9ead71449beb1704a71a61adf6bd13e7a66542d5c2bfac2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000100_serialize_jumia_disconnect_purge.sql',
    sha256: 'f051891d4b3b48e8928e8e7ef0879ac97909ad3bbdfdd21a7d86169cfcd45852',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000200_scope_jumia_disconnect_purge_to_locked_shop.sql',
    sha256: 'bd59247310c087e6811ff611507b462588a63fcbb43250007e15cc4d72715293',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000300_claim_jumia_discovery_and_fix_handoff.sql',
    sha256: '7d27621520df2f173b3382fca053d7f7d9ed57999317b6c2ff2e05bef5413c2a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000400_order_jumia_multi_shop_locks.sql',
    sha256: '6d1ca4f4cc494923cd60ef008cb8cc1844a7811676c16297f551da2a67cd61b1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000500_schedule_jumia_orphan_authorization_sweep.sql',
    sha256: '2ef84cf47dd191d491b8be7d61238389b9a43bd43956f84fa9b3dc56d97422cd',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000600_harden_jumia_shop_locks_and_orphan_sweep.sql',
    sha256: '7d8dda99f5415f36db99afc7692edbae2a438eb39223e5cb840ede0eb1bbf50f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000700_persist_jumia_oauth_integrations_atomically.sql',
    sha256: '0158b4a2394428b1c259f39ef391e662f37e0e99c09a9c357eceb2c44ab82d33',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000800_require_legacy_jumia_self_authorization_reconnect.sql',
    sha256: '55494b40db1fdcc8eb8f352976a03ac9b3577d4eb94673840fd7dab4b6d73e73',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000900_persist_existing_jumia_authorization_rotation.sql',
    sha256: '9b0d19fa7a5e6b478b6785997f03c89d263ed6f01d311776a58ad5a62f4c6ee9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825001000_purge_displaced_jumia_authorizations.sql',
    sha256: 'bfd04e28d8c15b5fa354fe95060d7a222dfb4867c27e564499f3b07213ce1c3c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825001100_allow_active_jumia_view_credential_refresh.sql',
    sha256: '2fba4e5bb89671a1b26c4f51157887b2118d5cd762530ae61672de6a1adf0570',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825154500_persist_shipment_shipping_quote.sql',
    sha256: '2e59aa9417a7245388e5e2af82669dc7b8edbd20f1052fa29889ba4049b08d7b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260826130000_add_follow_up_notification_preference.sql',
    sha256: '073009158808b2a75df6251c12dcaa5110c8ba65c8d166ef9df45520af6800a9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260826140000_read_follow_up_notification_preference_rpc.sql',
    sha256: '5df571384c2ce0cc9396d7f2e752eb710ea8bd44816504ad8aaf7de4214d2597',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827080000_bind_follow_up_notification_preference_to_invoice.sql',
    sha256: 'ad413b38e0df617994e0c4ad3cded3f856eecaa62fe16897cf682d6434d86920',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110003_restore_jumia_manage_credential_rotation_after_view.sql',
    sha256: 'a60ebbb878c90266d34bc83d6596fbcbff4f07d1f31f10db5e59a0e3de447081',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110101_recheck_jumia_oauth_self_authorization_conflicts.sql',
    sha256: '81631bd7f3a9da60fc97d0481c2038c182124f106e1ee2fdaaea568540eae304',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831100000_harden_jumia_product_mappings_staff_writes.sql',
    sha256: '0c635102ff87a9e8c12f6761c4af4a7d1efb8d0c80e45857e0f0a71091d12313',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831110000_jumia_order_marketplace_scope.sql',
    sha256: 'fe85882e631fc3c2c865be239f7fe17f2c2691f7f6ac00eaec097e170816c0ae',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831125000_align_jumia_marketplace_country_constraint.sql',
    sha256: '52152da8340f99a1e7e0898aada19bc61cf1c48da26e34400ac0a78e781078df',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831130000_scope_jumia_marketplace_country_constraint.sql',
    sha256: 'cc516a1093b1d9e6a3a188c1b19bf571c32079fa76dfc2b77e2ace75a73b4ea4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831140000_extend_jumia_discovery_claim_ttl.sql',
    sha256: '0161b23fbbc29f03d2113b618cdf1a1053d8212dba4da9597775bd984cffc36c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831150000_serialize_jumia_disconnect_cleanup.sql',
    sha256: 'fae80eda1c7a26735f6de22006ce42c7b0094a2eee7793c68554b7bca2a2bb7c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831160000_preserve_jumia_rotation_during_shop_persistence.sql',
    sha256: 'a21211f8b0231e5eb38bb16d82f45ab09d14515408cf6d6d0f930f974388e72c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831160100_release_jumia_authorization_refresh_lease.sql',
    sha256: '5bfe665193f30e2529c3fef9f7ec147df5c89b6ac112c24f9178d732968bc3a5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260901090000_restrict_jumia_authorization_ciphertext.sql',
    sha256: '388b451a04beb537b092e7586c425628ccde407314bb6a1d6fe520cd7dafcc31',
  },
  {
    repositoryPath:
      'supabase/migrations/20260901100000_restrict_jumia_authorization_credential_rpc.sql',
    sha256: 'c562a102ddd1cef3454789378e04bd1fc684bc67eec1a147a9df2cee4d96592e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260901110000_lock_jumia_orphan_sweep_authorizations.sql',
    sha256: '3b669c5c8a9a8f1da883e9ca5612dce829079b9be626145d0103912e197304db',
  },
  {
    repositoryPath:
      'supabase/migrations/20260901120000_drop_legacy_jumia_discovery_consume.sql',
    sha256: '6cd37ad6eabee554f1c81b0ad7e5cdbca95027a7c86456d1fa4a016e908aba51',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923090000_harden_jumia_orphan_sweep_shared_refs.sql',
    sha256: 'edf5e142f5f73cf423326dfe6d2c85684fa2d830315c484adc04d74503363c92',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923100000_restore_jumia_authorization_credential_rpc.sql',
    sha256: '8d048cf502721cc58c666a6651e9289b9997a3d2cdc7044c7656317c0c8b3e5e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923110000_restrict_jumia_credential_rpc_to_manage.sql',
    sha256: 'e2375cf103299dc39efa13454c7cbf5cd76d8a487356e67d73b6bfff35558916',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924120000_apply_jumia_variant_prices_atomically.sql',
    sha256: 'a0acfada91ec1a64c1ff238832e9b5b38aa99f0ae8a3432a58a3ace867693ac9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924130000_revoke_anon_jumia_discovery_purge_rpc.sql',
    sha256: 'fc9190ea972d1555dce8f28942d7fd8a81f140ced847aeddb31b9048347f8737',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924140000_revoke_jumia_credential_rpc_from_authenticated.sql',
    sha256: 'b15f28ed9fb5118d3369a4dbb576720bef93e63ea7ecdc9bfd8d15e780f3fa20',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924150000_report_jumia_disconnect_reconnect_races.sql',
    sha256: 'b9ddf0070753616236a5625ba24cbcd791b29e92c1d8efd2e67fd666795a1a0a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924160000_jumia_credential_loader_capability.sql',
    sha256: '933390d3e7b821bfeb047a58653a968bcf11fe12fae9c47e75f1c6e89f7cd414',
  },
  {
    repositoryPath:
      'supabase/migrations/20260925120000_raise_jumia_credential_ciphertext_limit.sql',
    sha256: 'edaedf263179eedfc00b7ef6f37c72cd05a8ef9327c028b15c6795b53a739c8f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260831153000_optimize_storefront_pdp_semantic_reads.sql',
    sha256: 'a402b932c082f876b44feb1cd98ef4d879641a0a5e075b52a05fb0a9b7df43dc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260901123000_repair_storefront_semantic_inventory_indexes.sql',
    sha256: '2999879d1a4127e4b703c8cb18a88f276ced6b2512331c1383402fdf36fff76d',
  },
  ...EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260905183000_share_storefront_cache_invalidation_causal_identity.sql',
    sha256: 'e87f8b3e8fecf098cc148d4efc75c75f62a96e0b4bdc98cdb904a91157a33c42',
  },
  ...EXPECTED_REPAIR_PICKUP_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260907111036_repair_sales_exclusion_wallet_version_collision.sql',
    sha256: '2676132ef759384de03f6ad7eeed2f7e1e38abac02013aaca634bfb957106482',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911100000_add_storefront_comparison_revisions.sql',
    sha256: '4c4264dd85683ca3302fd0f8cea0b01a13c8730c44b85af52b53b53028de5517',
  },
  ...REDVAULT_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260918000000_public_active_product_offers.sql',
    sha256: '06b8543596df16e6fa5fb5d24c6c2ef7418d34845c9189853a3187f34883b7a2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260920200000_stale_feed_manifest_on_offer_change.sql',
    sha256: '7de47f950351dfd8945be917d091dc50fd5ca80948566b20eb617c5c43e83718',
  },
  {
    repositoryPath:
      'supabase/migrations/20260921130000_include_tracking_order_amount_paid.sql',
    sha256: '2dfc3e7d95e55cd202ee973cbf149f0e0447cf1d6248c7c6132348f3cc78c0df',
  },
  {
    repositoryPath:
      'supabase/migrations/20260921180100_include_tracking_order_payment_accounts.sql',
    sha256: 'e4cc677df89fc76136e7ad3d6439d07893df34d6e064f0941951ec1d0c2723c9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150000_include_tracking_order_method_and_import_source.sql',
    sha256: '8f48eadc61f6a052ba2d7ae7ff5c0386bb75fae35eca5625b52aedd00432260c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150100_invoice_artifact_proof_bound_rpcs.sql',
    sha256: 'ce700c747390cbaddac5282dd933b7c83273ad747dec77a70fb2b7b4b3b12425',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150200_include_tracking_order_notification_delivered.sql',
    sha256: '9850261e1093a2d791503e94ae109d371f79a5d0a8bd7863b27b9fc5880b6cf2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923130000_immediate_order_notification_claims.sql',
    sha256: '10419b71140b08a494ec6a223c96f8424815dbc477d4593fd7e5248270a61bde',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150300_revoke_immediate_order_notification_public_execute.sql',
    sha256: 'b025e24686a6bdaf77c1fabfb7beba99f545b400f0bdd91515a8b0c0338a32cb',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150400_add_orders_paid_at_column.sql',
    sha256: 'bd5cccf3ac9ed07e28b34c8fe043d1014455e0226d988947adade5744921cbbf',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150500_immediate_order_notification_proof_claims.sql',
    sha256: 'a55ec9470c3cd0a9c3d645d2dd3a5d09ab1dd37dd89cddb8123119e8d469df32',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150700_order_notification_delivered_lookup.sql',
    sha256: 'dd11de26ac256e7665a34756f2a50ffea229706732671a98cd3fdfa7a1ac6ddc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923151000_sessionless_payment_reference_snapshot.sql',
    sha256: 'e10d138131ec25153b611169724299051b64795e0048a16e76a5a2a3aa966401',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150800_lease_immediate_order_notification_completion.sql',
    sha256: 'c6f81e3a5a81c76f74f6dd912374b7c4332d130b5dbd2023577266fb017ada6a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923150900_revoke_lookup_rpc_anon_execute.sql',
    sha256: '8543cae12a05a48853de05cb3292998b4140f1a1e22dc5cdeb7363a9cd598e19',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923151100_immediate_notification_completion_proof.sql',
    sha256: '6cdaa43c45289a44f4fc2ddefaf78af154d42fe895e5f6315f3f9e6d86fef9d6',
  },
  {
    repositoryPath: 'supabase/migrations/20260921180000_get_santa_catalog.sql',
    sha256: 'ccb69b3c76fc8fccdd2832177f66e2fb508afef422f554adf0ba9d792a58b19a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922120100_verify_payment_reference_token_rpc.sql',
    sha256: '16fee07c93035f58783ea0dcde7688b7c8155adedeb522b5dee446a3e932ba1d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922210000_guest_payment_reference_snapshot.sql',
    sha256: '1c8a5b5eaa76aa70b3f14f8d4772f013e53d3275bd6aec4b9608ab2a5f3c77d3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922220000_guest_payment_reference_snapshot_minimal.sql',
    sha256: '02eeeffc747952e75c15025baa6556ae1013da364c698cd8e3261df43a706d38',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923120000_guest_snapshot_inventory_proof.sql',
    sha256: '3864292ba62afad64de22549f334e2080fc558602bc31a94c6cdc9d233974614',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922120000_normalize_product_key_specs_gpu.sql',
    sha256: '27140ce538838e4a31f6fbc2f9871eaa3697d02888aed5d3b360c5f68ccd2245',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924090000_quiz_start_guard_context_v2.sql',
    sha256: 'ad1b4afac28db2099449ef0f63208ef0401ea9bad9e9f0dfbee1041effd83bd2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260925090000_pr3468_followup_payment_hardening.sql',
    sha256: 'e92fdbcad279fb7cbf8bc1553404b5e54026c124e2b0c5c29d334b9cd2b1bad7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260925100000_credit_direct_inventory_proof.sql',
    sha256: 'd48421f956f86ef4c18a4fcf84eb74f0f4ea9a486393fc957e5ac659d1691eea',
  },
]
  .sort((left, right) =>
    left.repositoryPath.localeCompare(right.repositoryPath)
  )
  .filter(
    (source, index, sources) =>
      sources.findIndex(
        (candidate) => candidate.repositoryPath === source.repositoryPath
      ) === index
  );
