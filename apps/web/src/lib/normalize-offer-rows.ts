import type { RelatedBlogProductOffer } from '@/lib/related-blog-products';
import { toFinitePrice } from '@/lib/to-finite-price';
import { isSameConditionOffer } from './is-same-condition-offer';
import { isOfferStockRow } from './related-blog-offer-stock-row';

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
