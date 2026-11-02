// FROZEN pre-registry expected pending sources, in their original aggregator
// order (unsorted, with duplicates; the builder sorts and de-duplicates).
// Do not add imports or entries here: register a new migration in its own
// `replay-registry/<YYYYMMDDHHMMSS>_<slug>/expected-pending-sources.txt`
// folder (see `replay-registry/README.md`). `replay-registry-baseline.test.ts`
// pins this set together with the registry baseline folder.
import { ADMIN_PLATFORM_PENDING_SOURCES } from './expected-admin-platform-pending-sources.test-support';
import { EXPECTED_ADS_PENDING_SOURCES } from './expected-ads-pending-sources.test-support';
import { EXPECTED_BLOG_PENDING_SOURCES } from './expected-blog-pending-sources.test-support';
import { EXPECTED_BUILDER_PENDING_SOURCES } from './expected-builder-pending-sources.test-support';
import { EXPECTED_CART_PENDING_SOURCES } from './expected-cart-pending-sources.test-support';
import { EXPECTED_CATALOG_CACHE_PENDING_SOURCES } from './expected-catalog-cache-pending-sources.test-support';
import { EXPECTED_CONNECTOR_PENDING_SOURCES } from './expected-connector-pending-sources.test-support';
import { EXPECTED_DEFINER_PRIVILEGES_PENDING_SOURCES } from './expected-definer-privileges-pending-sources.test-support';
import { EXPECTED_DISCOVERY_PENDING_SOURCES } from './expected-discovery-pending-sources.test-support';
import { EXPECTED_EXPENSE_PENDING_SOURCES } from './expected-expense-pending-sources.test-support';
import { EXPECTED_GIGL_STAFF_ACCESS_PENDING_SOURCES } from './expected-gigl-staff-access-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_HARDENING_PENDING_SOURCES } from './expected-gigl-tracking-hardening-pending-sources.test-support';
import { EXPECTED_GIGL_TRACKING_PENDING_SOURCES } from './expected-gigl-tracking-pending-sources.test-support';
import { EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './expected-gigl-wallet-shipping-pending-sources.test-support';
import { EXPECTED_IMEI_PENDING_SOURCES } from './expected-imei-pending-sources.test-support';
import { EXPECTED_INVENTORY_PENDING_SOURCES } from './expected-inventory-pending-sources.test-support';
import { EXPECTED_JUMIA_PENDING_SOURCES } from './expected-jumia-pending-sources.test-support';
import { EXPECTED_LOYALTY_PENDING_SOURCES } from './expected-loyalty-pending-sources.test-support';
import { EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES } from './expected-manual-document-pending-sources.test-support';
import { EXPECTED_MERCHANT_CLASSIFICATION_PENDING_SOURCES } from './expected-merchant-classification-pending-sources.test-support';
import { EXPECTED_MERCHANT_CONTACT_PHONE_PENDING_SOURCES } from './expected-merchant-contact-phone-pending-sources.test-support';
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
import { EXPECTED_PIGGYVEST_CAPTURE_PENDING_SOURCES } from './expected-piggyvest-capture-pending-sources.test-support';
import { EXPECTED_PIGGYVEST_ENROLL_NAME_PENDING_SOURCES } from './expected-piggyvest-enroll-name-pending-sources.test-support';
import { EXPECTED_PLAN_TIER_PENDING_SOURCES } from './expected-plan-tier-pending-sources.test-support';
import { EXPECTED_PRIMARY_PENDING_SOURCES } from './expected-primary-pending-sources.test-support';
import { EXPECTED_QUIZ_LIVE_PENDING_SOURCES } from './expected-quiz-live-pending-sources.test-support';
import { REDVAULT_PENDING_SOURCES } from './expected-redvault-pending-sources.test-support';
import { EXPECTED_REPAIR_PICKUP_PENDING_SOURCES } from './expected-repair-pickup-pending-sources.test-support';
import { EXPECTED_SAVINGS_PENDING_SOURCES } from './expected-savings-pending-sources.test-support';
import { EXPECTED_SAVINGS_RUNTIME_PENDING_SOURCES } from './expected-savings-runtime-pending-sources.test-support';
import { EXPECTED_SEARCH_PENDING_SOURCES } from './expected-search-pending-sources.test-support';
import { EXPECTED_STORE_CREDIT_PENDING_SOURCES } from './expected-store-credit-pending-sources.test-support';
import { EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES } from './expected-storefront-order-pending-sources.test-support';
import { EXPECTED_WALLET_ORDER_PENDING_SOURCES } from './expected-wallet-order-pending-sources.test-support';
import { ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES } from './order-notification-outbox-pending-sources.test-fixture';
import { RECENT_PENDING_SOURCES } from './recent-pending-sources.test-fixture';

export const EXPECTED_LEGACY_PENDING_SOURCES: readonly {
  repositoryPath: string;
  sha256: string;
}[] = [
  ...EXPECTED_PIGGYVEST_ENROLL_NAME_PENDING_SOURCES,
  ...EXPECTED_MERCHANT_CONTACT_PHONE_PENDING_SOURCES,
  ...EXPECTED_PIGGYVEST_CAPTURE_PENDING_SOURCES,
  ...EXPECTED_GIGL_STAFF_ACCESS_PENDING_SOURCES,
  ...EXPECTED_STORE_CREDIT_PENDING_SOURCES,
  ...EXPECTED_IMEI_PENDING_SOURCES,
  ...EXPECTED_DEFINER_PRIVILEGES_PENDING_SOURCES,
  ...EXPECTED_ADS_PENDING_SOURCES,
  ...EXPECTED_CART_PENDING_SOURCES,
  ...EXPECTED_CONNECTOR_PENDING_SOURCES,
  ...EXPECTED_BUILDER_PENDING_SOURCES,
  ...EXPECTED_BLOG_PENDING_SOURCES,
  ...EXPECTED_MERCHANT_CLASSIFICATION_PENDING_SOURCES,
  ...EXPECTED_PENDING_ORDER_REFUND_SOURCES,
  ...EXPECTED_ORDER_CANCELLATION_PENDING_SOURCES,
  ...EXPECTED_MERCHANT_PAYMENT_PENDING_SOURCES,
  ...ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES,
  ...EXPECTED_CATALOG_CACHE_PENDING_SOURCES,
  ...EXPECTED_GIGL_TRACKING_PENDING_SOURCES.map(([filename, sha256]) => ({
    repositoryPath: `supabase/migrations/${filename}`,
    sha256,
  })),
  ...EXPECTED_PENDING_TAIL_SOURCES.identity,
  ...RECENT_PENDING_SOURCES.slice(0, 1),
  ...AUDIT_PENDING_SOURCES,
  ...RECENT_PENDING_SOURCES.slice(1, 6),
  ...PAYMENT_INGRESS_AND_PROVENANCE_PENDING_SOURCES.slice(0, 2),
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
  ...EXPECTED_QUIZ_LIVE_PENDING_SOURCES,
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
  ...EXPECTED_GIGL_WALLET_SHIPPING_PENDING_SOURCES,
  ...EXPECTED_REPAIR_PICKUP_PENDING_SOURCES,
  ...REDVAULT_PENDING_SOURCES,
  ...EXPECTED_PENDING_SEPT_SOURCES,
  ...EXPECTED_PLAN_TIER_PENDING_SOURCES,
  ...EXPECTED_PENDING_GUEST_CART_SOURCES,
  ...EXPECTED_PENDING_VTU_REPLAY_SOURCES,
  ...EXPECTED_DISCOVERY_PENDING_SOURCES,
  ...EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES,
  ...EXPECTED_SAVINGS_PENDING_SOURCES,
  ...EXPECTED_SAVINGS_RUNTIME_PENDING_SOURCES,
  ...EXPECTED_PRIMARY_PENDING_SOURCES,
  ...EXPECTED_PENDING_TAIL_SOURCES.recent,
  ...EXPECTED_PRIMARY_PENDING_SOURCES,
  ...EXPECTED_WALLET_ORDER_PENDING_SOURCES,
];
