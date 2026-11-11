import type { AnalyticsProduct } from './analytics-product';

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Template products (ogabassey grids) reach the cart with a formatted
 * display string in `price` and the amount in `rawPrice`. Funnel events
 * need the numeric amount (`/api/events` rejects a string price), so this
 * resolves it, or returns null when no numeric price exists.
 */
export function normalizeAnalyticsProduct(
  product: AnalyticsProduct
): AnalyticsProduct | null {
  const record = product as unknown as Record<string, unknown>;
  const price = finiteNumber(record.price) ?? finiteNumber(record.rawPrice);
  if (price === null) return null;
  return {
    id: String(product.id),
    name: product.name,
    price,
    category: product.category,
    categories: product.categories,
  };
}
