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
].sort((a, b) => a.repositoryPath.localeCompare(b.repositoryPath));
