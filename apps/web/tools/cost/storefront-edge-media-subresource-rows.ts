import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS } from './storefront-edge-media-subresource-analytics-rows';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS } from './storefront-edge-media-subresource-content-rows';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS } from './storefront-edge-media-subresource-navigation-rows';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS } from './storefront-edge-media-subresource-payment-rows';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** External image destinations emitted by released storefront components. */
export const STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS: readonly InventoryRow[] = [
  ...STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS,
  ...STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS,
  ...STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS,
  ...STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS,
];
