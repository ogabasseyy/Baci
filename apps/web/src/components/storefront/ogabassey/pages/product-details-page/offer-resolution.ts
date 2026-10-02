import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { resolvePublicProductOption } from '@/lib/resolve-public-product-option';
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
    inventory_tracking_policy?: string | null;
  }> | null
): ProductDetailsCurrentOffer {
  let price = productData.rawPrice || 0;
  if (!price && typeof productData.price === 'string') {
    price =
      Number.parseInt(productData.price.replace(/[^0-9]/g, ''), 10) || 0;
  }

  let selectedOffer: { price: number; stock_quantity: number | null } | undefined;

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
      selectedOffer = { price: offer.rawPrice, stock_quantity: offer.stock_quantity ?? offer.stock ?? null };
    }
  }

  if (variantSelection?.variant) {
    const option = resolvePublicProductOption(
      { ...productData, price },
      { variant: variantSelection.variant, resolvedVariantPrice: variantSelection.price,
        condition: selectedCondition }
    );
    price = option.price ?? price;
    const stock = option.stockQuantity;
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
      if (typeof variant.price_override === 'number') {
        price = variant.price_override;
      } else if (typeof variant.price_modifier === 'number') {
        price += variant.price_modifier;
        price = Math.max(0, price);
      }

      const option = resolvePublicProductOption(
        { ...productData, price }, { variant, resolvedVariantPrice: price, condition: selectedCondition }
      );
      return { price: formatCurrentOfferCurrency(option.price ?? price),
        rawPrice: option.price ?? price, stock: option.stockQuantity, id: productData.id };
    }
  }

  const option = resolvePublicProductOption(
    { ...productData, price }, { offer: selectedOffer, condition: selectedCondition }
  );
  return {
    price: formatCurrentOfferCurrency(option.price ?? price),
    rawPrice: option.price ?? price,
    stock: selectedOffer || productData.manage_stock !== false ? option.stockQuantity : 999,
    id: productData.id,
  };
}
