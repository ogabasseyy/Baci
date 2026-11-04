import { isAvailableProduct } from '../storefront-content/is-available-product';
import type { BrandCompareProductInput } from './compare-eligibility';

function parseStockValue(value?: number | string | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseCandidatePrice(
  value: number | string | undefined | null
): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

/**
 * Checks Phase 1 availability for price-band candidates.
 *
 * If availability fields are omitted (legacy fixtures), the candidate is treated
 * as eligible. If explicit availability fields are provided, requires condition
 * offers or positive effective stock on managed products.
 */
export function isPriceBandCandidateAvailable(
  product: BrandCompareProductInput
): boolean {
  const hasAvailabilityField =
    product.stock !== undefined ||
    product.stock_quantity !== undefined ||
    product.manage_stock !== undefined ||
    product.has_condition_offers !== undefined;

  if (!hasAvailabilityField) {
    return true;
  }

  if (product.has_condition_offers) {
    return true;
  }

  return isAvailableProduct({
    stock: parseStockValue(product.stock),
    stock_quantity: parseStockValue(product.stock_quantity),
    manage_stock: product.manage_stock,
  });
}
