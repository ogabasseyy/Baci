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
  const normalized = candidates.map((variant) => ({
    ...variant,
    attributes: normalizeFeedVariantStringAttributes(variant.attributes),
  }));
  const base = { ...product, variants: normalized };
  const selection = resolveDefaultVariantSelection({
    ...base,
    // The feed treats nullish manage_stock as unmanaged (9999 quantity).
    manage_stock: product.manage_stock ?? false,
  })?.variant;
  if (selection) return selection;
  // Fully sold-out managed families still need a deterministic SKU: rank by
  // condition/price and return the raw candidate instead of RPC creation
  // order.
  const rankedId = resolveDefaultVariantSelection({
    ...base,
    manage_stock: false,
  })?.variant.id;
  return (
    candidates.find((candidate) => candidate.id === rankedId) ?? candidates[0]
  );
}
