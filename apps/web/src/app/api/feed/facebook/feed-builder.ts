import { toGoogleListingCondition } from '@baci/shared/lib';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import { escapeXml } from '@/lib/xml-utils';
import { buildVariantFeedItems } from '../google-merchant/build-variant-feed-items';
import type {
  FeedMerchant,
  FeedProduct,
  ImageManifestMap,
} from '../google-merchant/feed-builder';
import { buildConditionOfferItems } from './build-condition-offer-items';

function isValidProductUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidFeedProduct(product: FeedProduct): boolean {
  if (!(product.id && product.name?.trim())) {
    return false;
  }

  if (Number.isFinite(product.price) && product.price > 0) {
    return true;
  }
  if (
    product.variant_model !== 'sku_matrix' &&
    product.offers?.some(
      (offer) =>
        offer.id &&
        toGoogleListingCondition(offer.condition) &&
        Number.isFinite(offer.price) &&
        offer.price > 0
    )
  )
    return true;

  return (
    product.variant_model === 'sku_matrix' &&
    getSkuMatrixFallbackEligibleVariants(product).length > 0
  );
}

function getSkuMatrixFallbackEligibleVariants(product: FeedProduct) {
  return (product.variants || []).filter((variant) => {
    const effectivePrice =
      variant.price_override ?? variant.price ?? product.price;
    return Boolean(variant.id && variant.condition && effectivePrice > 0);
  });
}

export function generateFacebookCatalogFeed(
  products: FeedProduct[],
  merchant: FeedMerchant,
  baseUrl: string,
  imageManifest: ImageManifestMap
): string {
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  const brandName = merchant.business_name;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  const items = products
    .filter(isValidFeedProduct)
    .map((product) => {
      const productUrl = buildAgentProductUrl({
        baseUrl: normalizedBaseUrl,
        product,
      });
      if (!isValidProductUrl(productUrl)) {
        return null;
      }

      const manifestEntries = imageManifest[product.id] || [];
      if (product.variant_model === 'sku_matrix') {
        return buildVariantFeedItems({
          product,
          variants: product.variants || [],
          manifest: manifestEntries,
          productUrl,
          currency,
          brand: product.brand || brandName,
          platform: 'facebook',
        });
      }
      return buildConditionOfferItems({
        brandName,
        currency,
        manifestEntries,
        product,
        productUrl,
      });
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(brandName)} - Facebook Catalog Feed</title>
    <link>${escapeXml(normalizedBaseUrl)}</link>
    <description>Facebook and Instagram product catalog for ${escapeXml(brandName)}</description>
${items}
  </channel>
</rss>`;
}
