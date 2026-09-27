import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { getEffectiveStock } from '@/lib/product-stock';
import type { RelatedBlogProductOffer } from '@/lib/related-blog-products';

export interface RelatedBlogOfferStockRow {
  compare_at_price?: number | string | null;
  condition?: string | null;
  price?: number | string | null;
  status?: string | null;
  stock_quantity?: number | string | null;
}

export function toFinitePrice(value: unknown): number | null {
  const price =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  return typeof price === 'number' && Number.isFinite(price) && price >= 0
    ? price
    : null;
}

function isOfferStockRow(value: unknown): value is RelatedBlogOfferStockRow {
  return typeof value === 'object' && value !== null;
}

function normalizeOfferCondition(value: unknown): string | undefined {
  return (
    (typeof value === 'string'
      ? normalizeCanonicalProductCondition(value)
      : '') || undefined
  );
}

/**
 * Mirror the categorized PDP ("Filter offers to exclude main product
 * condition"): an offer row carrying the parent product's own condition is
 * not a selectable alternate, so it must not mark the rail available or
 * advertise its price. Rows with an unknown condition are kept fail-open.
 */
export function isSameConditionOffer(
  offerCondition: unknown,
  parentCondition: string | null | undefined
): boolean {
  const normalizedOffer = normalizeOfferCondition(offerCondition);
  if (normalizedOffer === undefined) return false;
  return normalizedOffer === normalizeOfferCondition(parentCondition);
}

export function hasStockedOffer(
  data: unknown,
  parentCondition: string | null | undefined
): boolean {
  return (
    Array.isArray(data) &&
    data.some(
      (offer) =>
        isOfferStockRow(offer) &&
        !isSameConditionOffer(offer.condition, parentCondition) &&
        getEffectiveStock(offer) > 0
    )
  );
}

export function normalizeOfferRows(
  data: unknown,
  parentCondition: string | null | undefined
): RelatedBlogProductOffer[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((offer) => {
    if (!isOfferStockRow(offer)) return [];
    if (isSameConditionOffer(offer.condition, parentCondition)) return [];
    const price = toFinitePrice(offer.price);
    const compareAtPrice = toFinitePrice(offer.compare_at_price);
    return [
      {
        ...(price !== null ? { price } : {}),
        ...(compareAtPrice !== null
          ? { compare_at_price: compareAtPrice }
          : {}),
        ...(typeof offer.condition === 'string'
          ? { condition: offer.condition }
          : {}),
        status: offer.status ?? 'active',
        stock_quantity: toFinitePrice(offer.stock_quantity),
      },
    ];
  });
}
