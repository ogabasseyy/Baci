import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { mediaSubresource } from './storefront-edge-media-subresource-support';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** Checkout, BNPL, and payment-logo destinations. */
export const STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS: readonly InventoryRow[] =
  [
    mediaSubresource(
      'klump',
      'configured_klump_origin',
      'apps/web/src/components/storefront/ogabassey/pages/bnpl-launcher.tsx'
    ),
    mediaSubresource(
      'checkout-payment-paystack',
      'configured_paystack_asset_origin',
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    ),
    mediaSubresource(
      'checkout-payment-korapay',
      'configured_korapay_origin',
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    ),
    mediaSubresource(
      'checkout-payment-credpal',
      'configured_credpal_origin',
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    ),
    mediaSubresource(
      'checkout-payment-credit-direct',
      'configured_credit_direct_origin',
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    ),
    mediaSubresource(
      'checkout-payment-juicyway',
      'configured_juicyway_origin',
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    ),
    mediaSubresource(
      'utility-checkout-paystack-navigation',
      'configured_paystack_checkout_origin',
      'apps/web/src/components/storefront/ogabassey/components/utility-checkout.ts'
    ),
    mediaSubresource(
      'credpal',
      'configured_credpal_origin',
      'apps/web/src/components/storefront/ogabassey/pages/bnpl-launcher.tsx'
    ),
    mediaSubresource(
      'credit-direct',
      'configured_credit_direct_origin',
      'apps/web/src/components/storefront/ogabassey/pages/bnpl-launcher.tsx'
    ),
  ];
