import { createLogger } from '@/lib/logger';
import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';

const log = createLogger('Cart');

/**
 * Variant effective stock through the same unbounded storefront projection
 * the PDP hydrates (get_storefront_product_variants, paginated past any
 * population cap). The search MCP projection this check previously read is
 * capped at 129 rows per product, so a selectable later variant reported
 * zero and rolled back an available add. Unlimited tracking bypasses;
 * strict compares the projection's exact available_units; other policies
 * use the finite quantity with parent inheritance, mirroring the
 * price-options CTE — except on explicitly unmanaged parents, where
 * order creation skips the variant decrement and legacy variants stay
 * unbounded. A variant absent from the projection (vanished or
 * unpublished) reports zero; other lookup failures throw so the caller
 * retries instead of overselling.
 */
export async function resolveVariantEffectiveStock(
  productId: string,
  variantId: string,
  parentStock: number,
  isParentUnmanaged = false
): Promise<number> {
  const variantsByProduct = await getStorefrontProductVariantsByProductIds([
    productId,
  ]);
  if (!variantsByProduct) {
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const row = (variantsByProduct[productId] ?? []).find(
    (entry) => entry?.id === variantId
  );
  if (!row) {
    log.error('Variant stock check found no such variant:', variantId);
    return 0;
  }
  if (row.effective_policy === 'serialized_then_unlimited') {
    return Number.MAX_SAFE_INTEGER;
  }
  if (row.effective_policy === 'serialized_strict') {
    if (
      typeof row.available_units === 'number' &&
      Number.isFinite(row.available_units)
    ) {
      return Math.max(0, row.available_units);
    }
    log.error('Variant stock check found no unit count:', variantId);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  if (isParentUnmanaged) {
    return Number.MAX_SAFE_INTEGER;
  }
  return typeof row.stock_quantity === 'number' &&
    Number.isFinite(row.stock_quantity)
    ? row.stock_quantity
    : parentStock;
}
