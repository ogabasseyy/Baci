import type { Product } from '@/lib/products';

/**
 * The product fields the browser trackers read. Narrower than the catalog
 * `Product` so any storefront template (including ones with their own product
 * shape, such as ogabassey) can report funnel events without type casts.
 */
export type AnalyticsProduct = Pick<
  Product,
  'id' | 'name' | 'price' | 'category' | 'categories'
>;
