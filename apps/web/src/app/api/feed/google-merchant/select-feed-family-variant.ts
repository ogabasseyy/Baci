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
  const isFeedValid = (variant: FeedVariant) => {
    const price = variant.price_override ?? variant.price ?? product.price;
    return (
      Boolean(variant.id && toGoogleListingCondition(variant.condition)) &&
      Number.isFinite(price) &&
      price > 0
    );
  };
  const candidates = variants.filter(isFeedValid);
  const selection = resolveDefaultVariantSelection({
    ...product,
    variants: candidates.map((variant) => ({
      ...variant,
      attributes: normalizeFeedVariantStringAttributes(variant.attributes),
    })),
  });
  return selection?.variant ?? candidates[0];
}
