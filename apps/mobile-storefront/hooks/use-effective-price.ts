/**
 * useEffectivePrice - Calculates the displayed price based on selected product
 * options (condition, storage, variant) and any negotiated price.
 */

import type { ResolvedProductVariantSelection } from '@baci/shared/lib';
import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import type { Product } from '@/types/product';

export interface EffectivePrice {
  price: number;
  comparePrice: number | undefined;
}

function calculateEffectivePrice(
  product: Product,
  resolvedVariantSelection:
    | ResolvedProductVariantSelection<{
        compare_at_price?: number | null;
        id: string;
        image?: string;
        images?: string[];
        in_stock?: boolean;
        name?: string;
        stock_quantity?: number;
      }>
    | null
    | undefined,
  selectedCondition: string | null,
  preferredOfferId?: string | null,
  suppressOfferMatch?: boolean
): EffectivePrice {
  if (resolvedVariantSelection) {
    return {
      price: resolvedVariantSelection.price,
      comparePrice: resolvedVariantSelection.compareAtPrice,
    };
  }

  let price = product.price;
  let comparePrice = product.compare_at_price;

  const offer = findMatchingConditionOffer(
    product.offers,
    selectedCondition,
    preferredOfferId,
    suppressOfferMatch
  );

  if (offer) {
    price = offer.price;
    comparePrice = offer.compare_at_price;
  }

  return { price, comparePrice };
}

export function useEffectivePrice(
  product: Product | null | undefined,
  resolvedVariantSelection:
    | ResolvedProductVariantSelection<{
        compare_at_price?: number | null;
        id: string;
        image?: string;
        images?: string[];
        in_stock?: boolean;
        name?: string;
        stock_quantity?: number;
      }>
    | null
    | undefined,
  selectedCondition: string | null,
  negotiatedPrice: number | null,
  preferredOfferId?: string | null,
  suppressOfferMatch?: boolean
): EffectivePrice {
  if (!product) {
    return { price: 0, comparePrice: undefined };
  }

  const { price: calculatedPrice, comparePrice } = calculateEffectivePrice(
    product,
    resolvedVariantSelection,
    selectedCondition,
    preferredOfferId,
    suppressOfferMatch
  );

  // M11 FIX: Use ?? instead of || so negotiatedPrice of 0 is not treated as falsy
  const price = negotiatedPrice ?? calculatedPrice;

  return { price, comparePrice };
}
