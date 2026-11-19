// FROZEN pre-registry pending replay blocks, in their original aggregator
// order (the manifest filename-sorts every row, so block order is cosmetic).
// Do not add imports or blocks here: register a new migration in its own
// `replay-registry/<YYYYMMDDHHMMSS>_<slug>/pending-sources.txt` folder (see
// `replay-registry/README.md`). `replay-registry-baseline.test.ts` pins this
// set together with the registry baseline folder.
import { ADMIN_PLATFORM_PENDING_SOURCES } from './supabase-history-replay-admin-sources';
import { ADS_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-ads-pending-sources';
import { BLOG_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-blog-pending-sources';
import { BUILDER_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-builder-pending-sources';
import { CART_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-cart-pending-sources';
import { CHECKOUT_RECOVERY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-checkout-recovery-pending-sources';
import { CONNECTOR_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-connector-pending-sources';
import { DEFINER_PRIVILEGES_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-definer-privileges-sources';
import { DISCOVERY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-discovery-pending-sources';
import { EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-expense-pending-sources';
import { FEED_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-feed-pending-sources';
import { FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-follow-up-pending-sources';
import { GIGL_STAFF_ACCESS_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-gigl-staff-access-sources';
import { GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-gigl-tracking-pending-sources';
import { GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './supabase-history-replay-gigl-wallet-sources';
import { IMEI_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-imei-sources';
import { INVENTORY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-inventory-pending-sources';
import { JUMIA_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-jumia-pending-sources';
import { LOYALTY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-loyalty-pending-sources';
import { MANUAL_DOCUMENT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-manual-document-pending-sources';
import { MERCHANT_CLASSIFICATION_PENDING_SOURCES } from './supabase-history-replay-merchant-classification-sources';
import { MERCHANT_CONTACT_PHONE_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-merchant-contact-phone-sources';
import { NEGOTIATION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-negotiation-pending-sources';
import { ONBOARDING_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-onboarding-pending-sources';
import { PENDING_SOURCES_HEAD } from './supabase-history-replay-pending-sources-head';
import { PIGGYVEST_CAPTURE_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-piggyvest-capture-sources';
import { PIGGYVEST_ENROLL_NAME_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-piggyvest-enroll-name-sources';
import { PRIMARY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-primary-pending-sources';
import { REDVAULT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-redvault-pending-sources';
import { REFUND_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-refund-pending-sources';
import { REPAIR_PICKUP_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-repair-pickup-pending-sources';
import {
  SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS,
  SAVINGS_PENDING_REPLAY_SOURCE_ROWS,
} from './supabase-history-replay-savings-pending-sources';
import { SAVINGS_RUNTIME_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-savings-runtime-pending-sources';
import { SEARCH_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-search-pending-sources';
import { STORE_CREDIT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-store-credit-sources';
import { STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES } from './supabase-history-replay-storefront-cluster-guide-pending-sources';
import { STOREFRONT_COMPARISON_PENDING_REPLAY_SOURCE_ROW } from './supabase-history-replay-storefront-comparison-pending-sources';
import { STOREFRONT_ORDER_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-storefront-order-pending-sources';
import { STOREFRONT_ORDER_TAIL_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-storefront-order-tail-pending-sources';
import { STOREFRONT_SEMANTIC_PENDING_SOURCE_ROWS } from './supabase-history-replay-storefront-semantic-sources';
import { VTU_CHECKOUT_RLS_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-vtu-checkout-rls-pending-sources';
import { VTU_EMAIL_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-vtu-email-pending-sources';
import { VTU_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-vtu-pending-sources';
import { WALLET_ORDER_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-wallet-order-sources';

export const LEGACY_PENDING_SOURCE_BLOCKS: readonly string[] = [
  PIGGYVEST_ENROLL_NAME_PENDING_REPLAY_SOURCE_ROWS,
  PIGGYVEST_CAPTURE_PENDING_REPLAY_SOURCE_ROWS,
  GIGL_STAFF_ACCESS_PENDING_REPLAY_SOURCE_ROWS,
  STORE_CREDIT_PENDING_REPLAY_SOURCE_ROWS,
  MERCHANT_CONTACT_PHONE_PENDING_REPLAY_SOURCE_ROWS,
  IMEI_PENDING_REPLAY_SOURCE_ROWS,
  DEFINER_PRIVILEGES_PENDING_REPLAY_SOURCE_ROWS,
  REFUND_PENDING_REPLAY_SOURCE_ROWS,
  CART_PENDING_REPLAY_SOURCE_ROWS,
  BUILDER_PENDING_REPLAY_SOURCE_ROWS,
  CONNECTOR_PENDING_REPLAY_SOURCE_ROWS,
  VTU_PENDING_REPLAY_SOURCE_ROWS,
  VTU_EMAIL_PENDING_REPLAY_SOURCE_ROWS,
  CHECKOUT_RECOVERY_PENDING_REPLAY_SOURCE_ROWS,
  DISCOVERY_PENDING_REPLAY_SOURCE_ROWS,
  MANUAL_DOCUMENT_PENDING_REPLAY_SOURCE_ROWS,
  PENDING_SOURCES_HEAD,
  PRIMARY_PENDING_REPLAY_SOURCE_ROWS,
  STOREFRONT_ORDER_PENDING_REPLAY_SOURCE_ROWS,
  STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES,
  STOREFRONT_SEMANTIC_PENDING_SOURCE_ROWS,
  STOREFRONT_ORDER_TAIL_PENDING_REPLAY_SOURCE_ROWS,
  ADS_PENDING_REPLAY_SOURCE_ROWS,
  ADMIN_PLATFORM_PENDING_SOURCES,
  EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS,
  FEED_PENDING_REPLAY_SOURCE_ROWS,
  FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS,
  ONBOARDING_PENDING_REPLAY_SOURCE_ROWS,
  GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS,
  GIGL_WALLET_SHIPPING_PENDING_SOURCES,
  INVENTORY_PENDING_REPLAY_SOURCE_ROWS,
  JUMIA_PENDING_REPLAY_SOURCE_ROWS,
  LOYALTY_PENDING_REPLAY_SOURCE_ROWS,
  NEGOTIATION_PENDING_REPLAY_SOURCE_ROWS,
  REPAIR_PICKUP_PENDING_REPLAY_SOURCE_ROWS,
  REDVAULT_PENDING_REPLAY_SOURCE_ROWS,
  SEARCH_PENDING_REPLAY_SOURCE_ROWS,
  STOREFRONT_COMPARISON_PENDING_REPLAY_SOURCE_ROW,
  BLOG_PENDING_REPLAY_SOURCE_ROWS,
  MERCHANT_CLASSIFICATION_PENDING_SOURCES,
  SAVINGS_PENDING_REPLAY_SOURCE_ROWS,
  SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS,
  SAVINGS_RUNTIME_PENDING_REPLAY_SOURCE_ROWS,
  VTU_CHECKOUT_RLS_PENDING_REPLAY_SOURCE_ROWS,
  WALLET_ORDER_PENDING_REPLAY_SOURCE_ROWS,
];
