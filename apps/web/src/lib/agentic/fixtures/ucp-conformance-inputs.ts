import type { buildAgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import {
  buildUcpCatalogProductsResponse,
  mapUcpCatalogProductRow,
  UCP_CATALOG_SEARCH_CAPABILITY,
} from '@/lib/agentic/ucp-catalog-adapters';

// A price with kobo: N39.98 is 3998 minor units. Two of them cost 7996.
export const MAJOR_PRICE = 39.98;
export const UNIT_MINOR = 3998;
export const LINE_MINOR = 7996;

export type ManifestMerchant = Parameters<typeof buildAgentCommerceManifest>[0];

export const MERCHANT: ManifestMerchant = {
  business_name: 'Ogabassey',
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
  slug: 'ogabassey',
};

export async function buildProfile(merchant: ManifestMerchant = MERCHANT) {
  const { buildAgentCommerceManifest } = await import(
    '@/lib/agentic/agent-commerce-manifest'
  );
  const { buildUcpDiscoveryProfile } = await import(
    '@/lib/agentic/ucp-discovery-profile'
  );
  return buildUcpDiscoveryProfile(
    buildAgentCommerceManifest(merchant, 'https://ogabassey.com')
  );
}

const PRODUCT_ROW = {
  description: 'A phone priced with kobo',
  id: 'product-1',
  manage_stock: true,
  merchant_id: 'merchant-1',
  name: 'Kobo phone',
  price: MAJOR_PRICE,
  slug: 'kobo-phone',
  status: 'active',
  stock: 3,
};

export function searchResponse() {
  const product = mapUcpCatalogProductRow({
    baseUrl: 'https://ogabassey.com',
    currency: 'NGN',
    row: PRODUCT_ROW,
  });
  if (!product) throw new Error('Expected the product row to map');
  return {
    product,
    response: buildUcpCatalogProductsResponse({
      capability: UCP_CATALOG_SEARCH_CAPABILITY,
      products: [product],
    }),
  };
}

export function cartResponse() {
  return buildUcpCartResponse({
    cartId: 'cart_1',
    continueUrl: 'https://ogabassey.com/ogabassey/cart#handoff=example',
    currency: 'NGN',
    lineItems: [
      {
        base_amount: LINE_MINOR,
        discount: 0,
        id: 'line_1',
        item: {
          id: 'variant-1',
          product_id: 'product-1',
          quantity: 2,
          title: 'Kobo phone',
        },
        subtotal: LINE_MINOR,
        tax: 0,
        total: LINE_MINOR,
      },
    ],
    status: 'active',
    totals: [
      { amount: LINE_MINOR, display_text: 'Subtotal', type: 'subtotal' },
      { amount: LINE_MINOR, display_text: 'Total', type: 'total' },
    ],
  });
}

export function orderBody(shippingStatus: string) {
  return {
    checkout_id: 'agentic_session_1',
    currency: 'NGN',
    discount_amount: 0,
    id: 'order-1',
    links: { track_order: 'https://ogabassey.com/track-order' },
    order_items: [
      {
        id: 'order-item-1',
        line_extension_amount: 79.96,
        name: 'Kobo phone',
        price: MAJOR_PRICE,
        product_id: 'product-1',
        quantity: 2,
        variant_id: 'variant-1',
      },
    ],
    shipping_fee: 0,
    shipping_status: shippingStatus,
    subtotal: 79.96,
    tax_amount: 0,
    total: 79.96,
    updated_at: '2026-10-31T09:00:00.000Z',
  };
}
