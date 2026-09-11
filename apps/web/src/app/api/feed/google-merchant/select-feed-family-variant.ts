import {
  resolveDefaultVariantSelection,
  toGoogleListingCondition,
} from '@baci/shared/lib';
import type { FeedProduct, FeedVariant } from './feed-types';
import { normalizeFeedVariantStringAttributes } from './normalize-feed-variant-string-attributes';

export function selectFeedFamilyVariant(
  product: FeedProduct,
  variants: FeedVariant[]
): FeedVariant | undefined {
  const selection = resolveDefaultVariantSelection({
    ...product,
    variants: variants.map((variant) => ({
      ...variant,
      attributes: normalizeFeedVariantStringAttributes(variant.attributes),
    })),
  });
  return (
    selection?.variant ??
    variants.find((variant) => {
      const price = variant.price_override ?? variant.price ?? product.price;
      return (
        Boolean(variant.id && toGoogleListingCondition(variant.condition)) &&
        Number.isFinite(price) &&
        price > 0
      );
    })
  );
}
