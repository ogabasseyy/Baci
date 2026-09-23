import { ADMIN_PLATFORM_PENDING_SOURCES } from './expected-admin-platform-pending-sources.test-support';
import { EXPECTED_CATALOG_CACHE_PENDING_SOURCES } from './expected-catalog-cache-pending-sources.test-support';
import { EXPECTED_EXPENSE_PENDING_SOURCES } from './expected-expense-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES } from './expected-gigl-tracking-hardening-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_PENDING_SOURCES } from './expected-gigl-tracking-pending-sources.test-support';
import { EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './expected-gigl-wallet-shipping-pending-sources.test-support';
import { EXPECTED_MERCHANT_INVOICE_PENDING_SOURCES } from './expected-merchant-invoice-pending-sources.test-support';
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
  {
    repositoryPath:
      'supabase/migrations/20260723000001_merchant_payment_credentials.sql',
    sha256: '67f823ff2e8758874e04d1e66365995dcf10840cf8e4db1180164e848afcc95e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000002_byok_direct_settlements.sql',
    sha256: '4127cea6c8c3b54f96c7cc051817100ec4c2cc536592cee670eef18ea921e330',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000003_paypal_capture_persist_reconciliation_issue.sql',
    sha256: 'dda2363ed20ac43cf85923f54280f26033479337e33f358149c6eae04432529c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000004_delete_merchant_payment_credential_role.sql',
    sha256: '0308b957a622c68bfa02f79dacda3243b61b678b91fdb20f4d3accb4994d3a73',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000005_orders_paid_transaction_marker.sql',
    sha256: '0b4f1455a50879471e899afeecdaefb0b03e1e1a7b5657c571cd400d7e8a6c5d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000006_orders_paid_transaction_marker_index.sql',
    sha256: '6b2f4f4139702abcd5be077a069769114d47b7f0302a7c4d69d8b6441007df51',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000007_credit_customer_wallet_order_refund.sql',
    sha256: 'd34e31e49b9d5a7ea3a2631d7a29d45a06e5cc0db76ce80019ea2a02dad4519e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000008_touch_merchant_credential_validated_by_environment.sql',
    sha256: '59247745bfa511c70e4c4d0bfdb26abc8652c5565ef9e994c1a29247deee8f1b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000009_public_snapshot_paypal_flags.sql',
    sha256: 'f2fe9d9345c4728a1a34f8cd44e6f1456fae2f18d88da6f7449cefce8d0a1de8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000010_transactions_refund_statuses.sql',
    sha256: '951c980acd5d98a49d10160e0d830b50bfe9c9c7ed33585dce2327bdd4b8d986',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000011_transactions_refund_pending_index.sql',
    sha256: 'f74bd1af1d8237976468e4df510b577e8b4de0947ba117fe9abb36cac6811e51',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000012_include_paypal_capture_persist_review_type.sql',
    sha256: '6f396c1d148a7971eaf4eaaea4e896211569f3b536fd65d71ea296fa63ccfcb5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000013_replace_merchant_payment_credential_pair.sql',
    sha256: '33d873748cd948a92c4cb32d2f12d3dba06670810fd4dc9b735fc54dac8ea0cc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000014_mark_savings_redemptions_reversed.sql',
    sha256: 'fd3391ef880d88b3b2f7083888a43099476489b52f6311dd004151efbebfe66d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000015_drop_legacy_credential_validation_touch.sql',
    sha256: 'cd91c66fed1a158455c83928e4eae42d3f3dd8a1db826c235e68857e689049fb',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000016_mark_paypal_transaction_refunded.sql',
    sha256: '6078df1576ec4ea3c94d565a6180242a688186c5e8e25ef943bb23144e6fa3c7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000017_order_payment_snapshot_merchant_country.sql',
    sha256: '6bb7429b5f50c4116febc9c5c41cd1244105b9d0852944954825c6139ea64718',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723000018_byok_fee_accrual_ledger.sql',
    sha256: 'de216327cc42bd2a1814771969823be8b598a3d00f4504e313a250e3f1baf5d0',
  },
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
    sha256: '046ef49e05a8f79f607db622a357f4b5ee0c0bee74037dbce4321389f293901d',
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
    sha256: '752cf9ccc7753d35a995cd8a4fc2cbee00fe3c8fc0ff54ccde52113baaecb7e6',
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
      'supabase/migrations/20260923130000_raise_jumia_credential_ciphertext_limit.sql',
    sha256: '32dc21b9fd4ade7f529f416c32bb446461bd6dd4b28963d0c8a62cff11679d8b',
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
    repositoryPath: 'supabase/migrations/20260921180000_get_santa_catalog.sql',
    sha256: 'ccb69b3c76fc8fccdd2832177f66e2fb508afef422f554adf0ba9d792a58b19a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922120000_normalize_product_key_specs_gpu.sql',
    sha256: '27140ce538838e4a31f6fbc2f9871eaa3697d02888aed5d3b360c5f68ccd2245',
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
