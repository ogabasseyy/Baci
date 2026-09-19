import { collectOfferClaimedImageUrls } from '@/lib/collect-offer-claimed-image-urls';
import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { isOfferClaimedUrl } from '@/lib/is-offer-claimed-url';
import type { ImageManifestMap } from '../google-merchant/feed-builder';
import type { OpenAIFeedVariant } from './feed-data';
import type { Product } from './feed-types';

function getManifestEntriesForProductVariant(
  imageManifest: ImageManifestMap,
  product: Product,
  variant?: OpenAIFeedVariant,
  excludeUrls: ReadonlySet<string> = new Set()
) {
  const manifestEntries = imageManifest[product.id] || [];
  if (!variant) {
    return manifestEntries;
  }

  const variantEntries = manifestEntries.filter(
    (entry) => entry.variant_id === variant.id
  );
  // A variant primary the claims exclude is unusable: fall through to
  // product-level entries only. Sibling-variant entries must not stand in
  // for the product image, or the row would advertise another SKU's image.
  if (resolveGmcPrimaryImage(variantEntries, excludeUrls)) {
    return variantEntries;
  }
  return manifestEntries.filter((entry) => !entry.variant_id);
}

function getProductImageUrl(
  product: Product,
  variant?: OpenAIFeedVariant,
  imageManifest: ImageManifestMap = {}
) {
  const offerClaimedImageUrls = collectOfferClaimedImageUrls(product.offers);
  const manifestPrimaryImage = resolveGmcPrimaryImage(
    getManifestEntriesForProductVariant(
      imageManifest,
      product,
      variant,
      offerClaimedImageUrls
    ),
    offerClaimedImageUrls
  );
  if (manifestPrimaryImage) {
    return manifestPrimaryImage;
  }

  const parentFirstImageRaw = product.images?.[0];
  const parentFirstImage =
    typeof parentFirstImageRaw === 'string'
      ? parentFirstImageRaw
      : parentFirstImageRaw?.url || '';
  // The raw fallback must not restore an offer-owned URL the manifest
  // path just excluded.
  const fallbackImage = isOfferClaimedUrl(
    parentFirstImage,
    offerClaimedImageUrls
  )
    ? ''
    : parentFirstImage;

  // A variant primary restored without the claim check would reintroduce
  // offer-owned imagery the manifest copy just excluded.
  if (isOfferClaimedUrl(variant?.primary_image, offerClaimedImageUrls)) {
    return fallbackImage;
  }

  return variant?.primary_image || fallbackImage;
}

function getAdditionalImageLinks(
  product: Product,
  imageManifest: ImageManifestMap = {},
  variant?: OpenAIFeedVariant
) {
  const offerClaimedImageUrls = collectOfferClaimedImageUrls(product.offers);
  const manifestAdditionalImages = resolveGmcAdditionalImages(
    getManifestEntriesForProductVariant(
      imageManifest,
      product,
      variant,
      offerClaimedImageUrls
    ),
    offerClaimedImageUrls
  );
  if (manifestAdditionalImages.length > 0) {
    return manifestAdditionalImages;
  }

  return product.images
    ?.slice(1, 11)
    .map((img) => (typeof img === 'string' ? img : img.url))
    .filter(
      (url): url is string =>
        typeof url === 'string' &&
        !isOfferClaimedUrl(url, offerClaimedImageUrls)
    );
}

/**
 * Resolve a legacy feed item's primary and additional image links from
 * the verified manifest, excluding offer-claimed URLs (including through
 * the raw product-images fallbacks).
 */
export function resolveLegacyFeedImages(
  product: Product,
  variant: OpenAIFeedVariant | undefined,
  imageManifest: ImageManifestMap = {}
): { image_link: string; additional_image_links?: string[] } {
  const image_link = getProductImageUrl(product, variant, imageManifest);
  return {
    image_link,
    additional_image_links: getAdditionalImageLinks(
      product,
      imageManifest,
      variant
    )?.filter((url) => url !== image_link),
  };
}
