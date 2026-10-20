import { ADMIN_PLATFORM_PENDING_SOURCES } from './expected-admin-platform-pending-sources.test-support';
import { EXPECTED_BLOG_PENDING_SOURCES } from './expected-blog-pending-sources.test-support';
import { EXPECTED_CART_PENDING_SOURCES } from './expected-cart-pending-sources.test-support';
import { EXPECTED_CATALOG_CACHE_PENDING_SOURCES } from './expected-catalog-cache-pending-sources.test-support';
import { EXPECTED_CONNECTOR_PENDING_SOURCES } from './expected-connector-pending-sources.test-support';
import { EXPECTED_DISCOVERY_PENDING_SOURCES } from './expected-discovery-pending-sources.test-support';
import { EXPECTED_EXPENSE_PENDING_SOURCES } from './expected-expense-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES } from './expected-gigl-tracking-hardening-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_PENDING_SOURCES } from './expected-gigl-tracking-pending-sources.test-support';
import { EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './expected-gigl-wallet-shipping-pending-sources.test-support';
import { EXPECTED_INVENTORY_PENDING_SOURCES } from './expected-inventory-pending-sources.test-support';
import { EXPECTED_JUMIA_PENDING_SOURCES } from './expected-jumia-pending-sources.test-support';
import { EXPECTED_LOYALTY_PENDING_SOURCES } from './expected-loyalty-pending-sources.test-support';
import { EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES } from './expected-manual-document-pending-sources.test-support';
import { EXPECTED_MERCHANT_INVOICE_PENDING_SOURCES } from './expected-merchant-invoice-pending-sources.test-support';
import { EXPECTED_MERCHANT_PAYMENT_PENDING_SOURCES } from './expected-merchant-payment-pending-sources.test-support';
import { EXPECTED_NEGOTIATION_PENDING_SOURCES } from './expected-negotiation-pending-sources.test-support';
import { EXPECTED_ORDER_CANCELLATION_PENDING_SOURCES } from './expected-order-cancellation-pending-sources.test-support';
import { EXPECTED_PAYSTACK_PENDING_SOURCES } from './expected-paystack-pending-sources.test-support';
import { AUDIT_PENDING_SOURCES } from './expected-pending-audit-sources.test-support';
import { EXPECTED_PENDING_GUEST_CART_SOURCES } from './expected-pending-guest-cart-sources.test-support';
import { EXPECTED_PENDING_ORDER_REFUND_SOURCES } from './expected-pending-order-refund-sources.test-support';
import { PAYMENT_INGRESS_AND_PROVENANCE_PENDING_SOURCES } from './expected-pending-payment-ingress-sources.test-support';
import { EXPECTED_PENDING_SEPT_SOURCES } from './expected-pending-sept-sources.test-support';
import { EXPECTED_PENDING_TAIL_SOURCES } from './expected-pending-tail-sources.test-fixture';
import { EXPECTED_PENDING_VTU_REPLAY_SOURCES } from './expected-pending-vtu-replay-sources.test-support';
import { EXPECTED_PLAN_TIER_PENDING_SOURCES } from './expected-plan-tier-pending-sources.test-support';
import { EXPECTED_PRIMARY_PENDING_SOURCES } from './expected-primary-pending-sources.test-support';
import { EXPECTED_QUIZ_LIVE_PENDING_SOURCES } from './expected-quiz-live-pending-sources.test-support';
import { REDVAULT_PENDING_SOURCES } from './expected-redvault-pending-sources.test-support';
import { EXPECTED_REPAIR_PICKUP_PENDING_SOURCES } from './expected-repair-pickup-pending-sources.test-support';
import { EXPECTED_SAVINGS_PENDING_SOURCES } from './expected-savings-pending-sources.test-support';
import { EXPECTED_SAVINGS_RUNTIME_PENDING_SOURCES } from './expected-savings-runtime-pending-sources.test-support';
import { EXPECTED_SEARCH_PENDING_SOURCES } from './expected-search-pending-sources.test-support';
import { EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES } from './expected-storefront-order-pending-sources.test-support';
import { ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES } from './order-notification-outbox-pending-sources.test-fixture';
import { RECENT_PENDING_SOURCES } from './recent-pending-sources.test-fixture';

export const EXPECTED_PENDING_SOURCES = [
  ...EXPECTED_CART_PENDING_SOURCES,
  ...EXPECTED_CONNECTOR_PENDING_SOURCES,
  ...EXPECTED_BLOG_PENDING_SOURCES,
  ...EXPECTED_PENDING_ORDER_REFUND_SOURCES,
  ...EXPECTED_ORDER_CANCELLATION_PENDING_SOURCES,
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
  {
    repositoryPath:
      'supabase/migrations/20260805090300_add_least_privilege_gigl_tracking_worker.sql',
    sha256: '428d5dbcd1de46aa145882c9911b87ff8311ad51d407bfa40155044c1be0b9ab',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805091000_converge_gigl_tracking_worker_nologin.sql',
    sha256: '905c85dbec6badd8d2d2246f7283a5df97bb6511e61b5751a09687a0cf2f7aad',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql',
    sha256: 'a639ded915cb661e199187c31381c85c75b07930dbab9aa61cc29e4290f85ae7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260805170000_isolate_gigl_tracking_postgrest_capability.sql',
    sha256: 'c8073d92cb844bb9569c59e5c52b8a46a15d03e3e5c03f4e152c692a04311877',
  },
  ...EXPECTED_MERCHANT_INVOICE_PENDING_SOURCES,
  ...EXPECTED_PAYSTACK_PENDING_SOURCES,
  ...ADMIN_PLATFORM_PENDING_SOURCES,
  ...EXPECTED_EXPENSE_PENDING_SOURCES,
  ...EXPECTED_NEGOTIATION_PENDING_SOURCES,
  ...EXPECTED_INVENTORY_PENDING_SOURCES,
  ...EXPECTED_PENDING_TAIL_SOURCES.late,
  ...EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES,
  ...EXPECTED_JUMIA_PENDING_SOURCES,
  ...EXPECTED_LOYALTY_PENDING_SOURCES,
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
  ...EXPECTED_PENDING_SEPT_SOURCES,
  ...EXPECTED_PLAN_TIER_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260926120000_public_storefront_domain_resolution.sql',
    sha256: 'a234118a7dcf99f1eb9a7b9a56e7e45e887241c104e78ba0d4bb7cb2c3ef66db',
  },
  ...EXPECTED_PENDING_GUEST_CART_SOURCES,
  ...EXPECTED_PENDING_VTU_REPLAY_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20260928080000_product_discovery_embeddings.sql',
    sha256: '2d3dc25857186965c6bdafc8874b57d0ea64452b2ecba5fa14e13bc802272add',
  },
  ...EXPECTED_DISCOVERY_PENDING_SOURCES,
  ...EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES,
  ...EXPECTED_SAVINGS_PENDING_SOURCES,
  ...EXPECTED_SAVINGS_RUNTIME_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20261008174300_search_mobile_admin_transaction_review_orders.sql',
    sha256: 'e9245edba2df825604e770b769f0ec7e4949df83bc6aa4ec84740e33bb53c9a4',
  },
  ...EXPECTED_PRIMARY_PENDING_SOURCES,
  {
    repositoryPath:
      'supabase/migrations/20261013172724_fix_shipment_booking_refund_probe_permissions.sql',
    sha256: '58736f2055f1d497d2b273d290658e34b2006cbd0d81015cf7749e668aa29b11',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013194440_fix_shipping_quote_proof_canonicalization.sql',
    sha256: '8c6107207fadff4fe89a53b3f5c1b3a24230284cbeaa45599d3b348ea7f10dad',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013213516_customer_checkout_shipping_recovery_context.sql',
    sha256: 'ae81f71311b41528d8d730d90f2824a0a848223be0e2cdafb48b0ff77f27504f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013213522_customer_checkout_shipping_recovery_confirmation.sql',
    sha256: 'd771210edf2a907516c2c5739be97dcea90e1dbea0a15f3515802fb29b7ff48e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014080000_customer_checkout_shipping_recovery_scalar_address.sql',
    sha256: '112b39558139a8a4851659abc8ac6d73a4a5f1d68afd0a567d4cd0702eddf1a4',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120000_customer_checkout_shipping_recovery_review_followups.sql',
    sha256: '3182b0dbcc855c7a7838fb807dddcfd72c6c4bda1f8c966d0d8e210c613c8ca1',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014130000_customer_checkout_shipping_recovery_hardening.sql',
    sha256: '7bb0c5c818d6082db126c1da3a443746a4ff0ea59ee67a44a3e2c5eaef2a7b54',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014140000_customer_checkout_shipping_recovery_confirm_hardening.sql',
    sha256: '7e33008871585fe87dac30ca66c3e952841b099cadacab4c68cd39b4ede15059',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014210000_lease_vtu_customer_email_notification_attempt.sql',
    sha256: 'e4090f77f17032a4a0adc7e639f74e3e89794bb4f4792e717ac554791899de14',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015010000_fence_vtu_customer_email_notification_clear_by_lease.sql',
    sha256: '2112c1db75c246c7030a570434efdecfb7bbd2b95ce1b35b8a3ad37dba811a17',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015090001_storefront_payment_settings_shipping_insurance.sql',
    sha256: '5d563615e5bc1d14623f18f69f6c714bf818da85d1e89a9d485fc774f3cce8f3',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015115210_customer_checkout_shipping_recovery_acl_and_redaction_index.sql',
    sha256: 'c447cf6614df344591430a14df91201ae5404b1c6413e59d307205ec66641225',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015124602_customer_checkout_shipping_recovery_address_aliases.sql',
    sha256: '6c4e56759fea25200a28a748a848c9da213550bc678e47ba9fe7a2727823188c',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130721_customer_checkout_shipping_recovery_delivery_boundary.sql',
    sha256: '1c411255bf10472a71c0f38a2b744d246764453832b7a6e32091a72226f8ac6b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015145945_customer_checkout_shipping_recovery_committed_retry.sql',
    sha256: '6336d903431424e3824ab52afa21213eeeac968406b519cc8bdd0f1944734627',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015215000_customer_checkout_shipping_recovery_activation_gate.sql',
    sha256: '3131a8c8f65cc8d2a892d0e020cd67dfaaa425fa8dce6a2b8f7b605b1eddb0cc',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015232000_pair_vtu_customer_email_notification_keys.sql',
    sha256: '91c1c8b4d8934b33b39e6c61c27e0e948ad8f1dac925a8a689b30f2d7b09d597',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016090000_search_condition_match_hyphen.sql',
    sha256: '82e8ab798c5444cfcc1037f21bfb376940d15ae7801f0462efa12f32bde0b274',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016100000_storefront_order_replay_key_floor.sql',
    sha256: '35bb3fc0bca3a6e133e1909c7dc53179709819abf734ae6ae573f8a505709039',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016110000_storefront_order_item_offer_id_snapshot.sql',
    sha256: '35e6dc838033f09f69ed12d479988833a9d6dbfe0b41905093998584eac0ae18',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016115000_storefront_order_item_offer_identity_hardening.sql',
    sha256: 'efb4ed9615d183d01155ab7ceedf1509228afb85a4d15e6adc8da80ff3e75e26',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016120000_finalize_vtu_customer_email_notification_attempt.sql',
    sha256: '300563b107439d9d998a06681a1f22c9d619b62cc651133c4d5e3f2903ee90f4',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016123000_finalize_vtu_customer_email_notification_success.sql',
    sha256: 'd55343f9a7c3079f09ace5e32778917e994ceef097b24773a3194d5f5bd78bc9',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016125000_storefront_order_replay_economics_offer_snapshot.sql',
    sha256: '3e4ef56adae86434136c65c4c19e63c1ab04c2a62e4316ad0cbec1f77222b4e7',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016130000_guard_vtu_customer_email_claim_against_unknown.sql',
    sha256: 'e304307c90cb3e52c3c1e4dfa8b1cbec46edaea6eca1b67fde5b164743681fd3',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016140000_storefront_order_item_offer_identity_freeze.sql',
    sha256: 'bff7b2dbb638298f1a0c464506bc23a5de3af1c5a0ab0ea9b9cf7e88f99f4bb0',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016150000_storefront_order_idempotency_key_entropy.sql',
    sha256: 'fb28c5d4994866dae1e83003b49d3ecfcd4d332b6f0d7a26b8b418c3f130fd21',
  },
  {
    repositoryPath:
      'supabase/migrations/20261016160000_storefront_order_item_offer_tenant_bind.sql',
    sha256: '8b78693d6a9d1a9ab76c23d667795f435d2f6eaf1fda34fecd2620d05014262d',
  },
  {
    repositoryPath:
      'supabase/migrations/20261019090000_storefront_order_offer_final_state.sql',
    sha256: 'b804e2f56ee988be072063735e81ca669c5af5c0fb6e12c2b62900aca8fcc582',
  },
  {
    repositoryPath:
      'supabase/migrations/20261019100000_storefront_order_item_offer_line_condition_identity.sql',
    sha256: 'e2a9e1c01d2e137e3b198752c4310999b88ffd5cde4ac96714f2218a600f649d',
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
