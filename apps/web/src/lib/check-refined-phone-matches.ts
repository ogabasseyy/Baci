import 'server-only';
import type {
  PublicAdvertisedVariant,
  PublicAdvertisedVariantLoader,
} from './advertised-phone-price-projection';
import {
  isCellularPhoneProduct,
  isRestrictedWifiOnlyVariant,
  type StorefrontVariantProductContext,
} from './storefront-variant-disclosure';

interface Match {
  productId: string;
  variantId?: string;
}
interface PhoneProduct extends StorefrontVariantProductContext {
  id: string;
  has_variants?: boolean | null;
  variant_model?: string | null;
}

export function hasPositiveWifiOnlyIntent(query: string): boolean {
  // A conservative opt-in: conflicting or negated requests are not permission
  // to recommend restricted devices. No filter or price bound is relaxed.
  return (
    /\bwi[\s-]*fi[\s-]*only\b/i.test(query) &&
    !/\b(?:not|no|without|avoid|exclude|excluding|except|non|never|neither|don'?t|doesn'?t)\b/i.test(
      query
    )
  );
}

/** Verify only the exact phone selections returned in this SQL result window. */
export async function checkRefinedPhoneMatches<T extends Match>(
  merchantId: string,
  query: string,
  matches: T[],
  products: ReadonlyMap<string, PhoneProduct>,
  loadVariants: PublicAdvertisedVariantLoader
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
    return positiveIntent
      ? [{ match, restrictedVariant: variant, verifiedVariant: variant }]
      : [];
  });
}
