import { getEffectiveStock } from '@/lib/product-stock';
import { isSameConditionOffer } from './is-same-condition-offer';
import { isOfferStockRow } from './related-blog-offer-stock-row';

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
