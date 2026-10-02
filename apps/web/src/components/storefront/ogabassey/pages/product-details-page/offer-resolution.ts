import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { getEffectiveStock } from '@/lib/product-stock';
import type { ResolvedProductVariantSelection } from '@baci/shared/lib';
import { type ConditionType, normalizeConditionType } from './product-condition';
import type { NormalizedProductDetails } from './product-normalization';

export interface ProductDetailsCurrentOffer {
  id: NormalizedProductDetails['id'];
  price: string;
  rawPrice: number;
  stock: number;
}

function formatCurrentOfferCurrency(value: number): string {
  return formatDisplayCurrency(value, undefined, { maximumFractionDigits: 0 });
}

export function resolveCurrentOffer(
  productData: NormalizedProductDetails,
  selectedCondition: ConditionType,
  selectedAttributes: Record<string, string>,
  variantSelection?: ResolvedProductVariantSelection<{
    id: string;
    price_override?: number | null;
    price_modifier?: number | null;
    stock_quantity?: number | null;
  }> | null
): ProductDetailsCurrentOffer {
  let price = productData.rawPrice || 0;
  if (!price && typeof productData.price === 'string') {
    price =
      Number.parseInt(productData.price.replace(/[^0-9]/g, ''), 10) || 0;
  }

  let stock = productData.manage_stock ? getEffectiveStock(productData) : 999;

  // Canonical on both sides: a legacy-spelled parent (uk_used,
  // refurbished) is the selection's own family, so same-condition offer
  // rows stay parent-priced instead of replacing parent price and stock.
  if (normalizeConditionType(productData.condition) !== selectedCondition) {
    // Canonical comparison: stored rows use merchant spellings (refurbished,
    // uk_used) that never equal the canonical selection raw, which silently
    // fell back to the parent price for exactly those offers.
    const offer = productData.offers?.find(
      (item) => normalizeConditionType(item.condition) === selectedCondition
    );

    if (offer) {
      price = offer.rawPrice;
      stock = getEffectiveStock(offer);
    }
  }

  if (variantSelection?.variant) {
    price = variantSelection.price;
    stock = getEffectiveStock(variantSelection.variant);
    return {
      price: formatCurrentOfferCurrency(price),
      rawPrice: price,
      stock,
      id: productData.id,
    };
  }

  const selectedAttributeKeys = Object.keys(selectedAttributes);
  if (selectedAttributeKeys.length > 0 && productData.variants) {
    const variant = productData.variants.find((item) => {
      const attributes = item.attributes || {};
      return selectedAttributeKeys.every((key) => {
        const legacyValue = (item as unknown as Record<string, unknown>)[key];
        return (
          attributes[key] === selectedAttributes[key] ||
          legacyValue === selectedAttributes[key]
        );
      });
    });

    if (variant) {
      if (variant.price_override) {
        price = variant.price_override;
      } else if (variant.price_modifier) {
        price += variant.price_modifier;
        price = Math.max(0, price);
      }

      stock = getEffectiveStock(variant);
    }
  }

  return {
    price: formatCurrentOfferCurrency(price),
    rawPrice: price,
    stock,
    id: productData.id,
  };
}
