import 'server-only';
import {
  type AdvertisedPhoneConstraints,
  type PublicAdvertisedVariant,
  type PublicAdvertisedVariantLoader,
  selectAdvertisedPhoneVariant,
} from './advertised-phone-price-projection';
import {
  isCellularPhoneProduct,
  type StorefrontVariantProductContext,
} from './cellular-phone-classification';
import { hasPositiveWifiOnlyIntent } from './has-positive-wifi-only-intent';
import { isRestrictedWifiOnlyVariant } from './restricted-wifi-variant';

interface Match {
  productId: string;
  variantId?: string;
  price?: number;
  condition?: string;
}
interface PhoneProduct extends StorefrontVariantProductContext {
  id: string;
  has_variants?: boolean | null;
  variant_model?: string | null;
}

/** Verify only the exact phone selections returned in this SQL result window. */
export async function checkRefinedPhoneMatches<T extends Match>(
  merchantId: string,
  query: string,
  matches: T[],
  products: ReadonlyMap<string, PhoneProduct>,
  loadVariants: PublicAdvertisedVariantLoader,
  options?: AdvertisedPhoneConstraints
): Promise<
  Array<{
    match: T;
    restrictedVariant?: PublicAdvertisedVariant;
    verifiedVariant?: PublicAdvertisedVariant;
  }>
> {
  const phoneMatches = matches.filter((match) => {
    const product = products.get(match.productId);
    return (
      product &&
      isCellularPhoneProduct(product) &&
      (match.variantId ||
        product.has_variants === true ||
        product.variant_model === 'sku_matrix')
    );
  });
  if (phoneMatches.length === 0) return matches.map((match) => ({ match }));
  const phoneIds = new Set(phoneMatches.map((match) => match.productId));
  const variants = await loadVariants(merchantId, [...phoneIds]);
  const positiveIntent = hasPositiveWifiOnlyIntent(query);
  return matches.flatMap((match) => {
    if (!phoneIds.has(match.productId)) return [{ match }];
    // An absent exact SKU cannot be replaced by the parent or another SKU
    // without potentially breaking the caller's filters and price bound.
    const variant = match.variantId
      ? (variants[match.productId] ?? []).find(
          (variant) =>
            variant.id === match.variantId &&
            variant.product_id === match.productId
        )
      : undefined;
    if (!variant) return [];
    if (!isRestrictedWifiOnlyVariant(variant))
      return [{ match, verifiedVariant: variant }];
    if (positiveIntent)
      return [{ match, restrictedVariant: variant, verifiedVariant: variant }];

    const product = products.get(match.productId);
    if (!product) return [];
    const fallback = selectAdvertisedPhoneVariant(
      product,
      variants[match.productId] ?? [],
      options,
      merchantId
    );
    if (fallback) {
      return [
        {
          match: {
            ...match,
            variantId: fallback.variant.id,
            ...(typeof fallback.price === 'number'
              ? { price: fallback.price }
              : {}),
            ...(fallback.condition ? { condition: fallback.condition } : {}),
          },
          verifiedVariant: fallback.variant,
        },
      ];
    }
    return [];
  });
}
