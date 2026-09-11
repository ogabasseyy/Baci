import { buildBaseItemXml } from './build-base-feed-item';
import { normalizeFeedVariantStringAttributes } from './normalize-feed-variant-string-attributes';
/**
 * Google Merchant Center feed XML builder.
 *
 * Pure XML builder using product data and a prevalidated image manifest.
 * All image URLs come exclusively from the `product_feed_images` manifest.
 */

import { toGoogleListingCondition } from '@baci/shared/lib';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { resolveOfferFeedImages } from '@/lib/resolve-offer-feed-images';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import { escapeXml } from '@/lib/xml-utils';
import { buildFeedDescription } from './build-feed-description';
import {
  buildGoogleColorXml,
  buildGoogleProductDetailXml,
} from './build-product-detail-xml';
import { buildVariantFeedItems } from './build-variant-feed-items';
import { getFeedStockCount } from './feed-stock';
import type {
  FeedDefaultVariant,
  FeedMerchant,
  FeedProduct,
  FeedVariant,
  ImageManifestMap,
} from './feed-types';
import { selectFeedFamilyVariant } from './select-feed-family-variant';

export type {
  FeedMerchant,
  FeedOffer,
  FeedProduct,
  FeedVariant,
  ImageManifestMap,
} from './feed-types';

interface ResolvedFeedImages {
  additionalImagesXml: string;
  primaryImageUrl: string;
}

const VALID_GMC_CONDITIONS = new Set(['new', 'used', 'refurbished'] as const);

export function toFeedDefaultVariant(variant: FeedVariant): FeedDefaultVariant {
  return {
    ...variant,
    attributes: normalizeFeedVariantStringAttributes(variant.attributes),
  };
}

function isValidForGmc(product: FeedProduct): boolean {
  if (
    product.variant_model !== 'sku_matrix' &&
    (!Number.isFinite(product.price) || product.price <= 0)
  )
    return false;
  if (!product.name || product.name.trim() === '') return false;
  return true;
}

function isValidGmcUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function buildAdditionalImagesXml(urls: string[]) {
  return urls
    .map(
      (url) =>
        `        <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`
    )
    .join('\n');
}

function resolveFeedImages(
  entries: FeedImageManifestEntry[]
): ResolvedFeedImages | null {
  const primaryImageUrl = resolveGmcPrimaryImage(entries);

  if (!primaryImageUrl) {
    return null;
  }

  return {
    primaryImageUrl,
    additionalImagesXml: buildAdditionalImagesXml(
      resolveGmcAdditionalImages(entries)
    ),
  };
}

function getProductLevelManifestEntries(entries: FeedImageManifestEntry[]) {
  return entries.filter((entry) => !entry.variant_id);
}

function getProductType(product: FeedProduct): string | undefined {
  const normalizedCategory = product.categories?.name?.trim();
  if (normalizedCategory) {
    return normalizedCategory;
  }

  const legacyCategory = product.category?.trim();
  if (legacyCategory) {
    return legacyCategory;
  }

  const categorySlug = product.category_slug?.trim();
  return categorySlug || undefined;
}

function toGmcCondition(condition?: string | null) {
  const gmcCondition = toGoogleListingCondition(condition);
  return gmcCondition && VALID_GMC_CONDITIONS.has(gmcCondition)
    ? gmcCondition
    : 'new';
}

function getConditionedVariants(product: FeedProduct) {
  return (product.variants || []).filter((variant) =>
    Boolean(toGoogleListingCondition(variant.condition))
  );
}

/** Generate XML using only prevalidated images; performs no network calls. */
export function generateGoogleMerchantFeed(
  products: FeedProduct[],
  merchant: FeedMerchant,
  baseUrl: string,
  imageManifest: ImageManifestMap
): string {
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  const brandName = merchant.business_name;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  const validProducts = products.filter(isValidForGmc);

  const items = validProducts
    .map((product) => {
      const productUrl = buildAgentProductUrl({
        baseUrl: normalizedBaseUrl,
        product,
      });
      if (!isValidGmcUrl(productUrl)) return null;

      const manifestEntries = imageManifest[product.id] || [];
      const productLevelImages = resolveFeedImages(
        getProductLevelManifestEntries(manifestEntries)
      );
      const description = buildFeedDescription(product);
      const colorXml = buildGoogleColorXml(product);
      const productDetailsXml = buildGoogleProductDetailXml(product);
      const shippingWeight =
        product.weight_value && product.weight_unit
          ? `        <g:shipping_weight>${product.weight_value} ${product.weight_unit}</g:shipping_weight>`
          : '';
      const effectiveBrand = product.brand || brandName;
      const productType = getProductType(product);
      if (product.variant_model === 'sku_matrix') {
        const variants = getConditionedVariants(product);
        const input = {
          product,
          variants,
          manifest: manifestEntries,
          productUrl,
          currency,
          brand: effectiveBrand,
          platform: 'google' as const,
          familyRow: merchant.gmc_variants_enabled === false,
        };
        if (!input.familyRow) return buildVariantFeedItems(input);
        // Rank only renderable SKUs; preserve the verified colour-image rule.
        const rows = new Map(
          variants.map((variant) => [
            variant.id,
            buildVariantFeedItems({ ...input, variants: [variant] }),
          ])
        );
        const selection = selectFeedFamilyVariant(
          product,
          variants.filter((variant) => Boolean(rows.get(variant.id)))
        );
        return selection ? rows.get(selection.id) : '';
      }
      const baseItem =
        productLevelImages && toGoogleListingCondition(product.condition)
          ? buildBaseItemXml({
              additionalImagesXml: productLevelImages.additionalImagesXml,
              availability:
                getFeedStockCount(product) > 0 ? 'in_stock' : 'out_of_stock',
              brandName: effectiveBrand,
              compareAtPrice: product.compare_at_price,
              condition: toGmcCondition(product.condition),
              colorXml,
              currency,
              description,
              googleProductCategory: product.google_product_category,
              gtin: product.gtin,
              id: product.id,
              imageUrl: productLevelImages.primaryImageUrl,
              mpn: product.mpn,
              price: product.price,
              productDetailsXml,
              productType,
              shippingWeight,
              stockCount: getFeedStockCount(product),
              title: product.name,
              url: productUrl,
            })
          : '';

      if (!product.offers || product.offers.length === 0) {
        return baseItem;
      }

      const offerItems = product.offers
        .filter(
          (offer) =>
            offer.id &&
            Number.isFinite(offer.price) &&
            offer.price > 0 &&
            toGoogleListingCondition(offer.condition)
        )
        .map((offer) => {
          const offerImages = resolveOfferFeedImages(
            offer.images,
            manifestEntries
          );
          if (!offerImages) return '';
          const offerStock = getFeedStockCount(product, offer);
          const offerAvailability =
            offerStock > 0 ? 'in_stock' : 'out_of_stock';

          const offerLines = [
            `        <g:id>${escapeXml(offer.id)}</g:id>`,
            `        <g:item_group_id>${escapeXml(product.id)}</g:item_group_id>`,
            `        <g:title>${escapeXml(product.name)}</g:title>`,
            `        <g:description>${escapeXml(description)}</g:description>`,
            `        <g:link>${escapeXml(`${productUrl}?condition=${offer.condition}`)}</g:link>`,
            `        <g:canonical_link>${escapeXml(productUrl)}</g:canonical_link>`,
            `        <g:image_link>${escapeXml(offerImages.imageUrl)}</g:image_link>`,
            offerImages.additionalImagesXml,
            `        <g:availability>${offerAvailability}</g:availability>`,
            `        <g:quantity>${offerStock}</g:quantity>`,
            `        <g:price>${offer.price.toFixed(2)} ${currency}</g:price>`,
            `        <g:brand>${escapeXml(effectiveBrand)}</g:brand>`,
            `        <g:condition>${toGmcCondition(offer.condition)}</g:condition>`,
            product.gtin
              ? `        <g:gtin>${escapeXml(product.gtin)}</g:gtin>`
              : '',
            product.mpn
              ? `        <g:mpn>${escapeXml(product.mpn)}</g:mpn>`
              : '',
            product.gtin || (product.mpn && effectiveBrand)
              ? '        <g:identifier_exists>yes</g:identifier_exists>'
              : '        <g:identifier_exists>no</g:identifier_exists>',
            colorXml,
            productDetailsXml,
            product.google_product_category
              ? `        <g:google_product_category>${escapeXml(product.google_product_category)}</g:google_product_category>`
              : '',
            productType
              ? `        <g:product_type>${escapeXml(productType)}</g:product_type>`
              : '',
            shippingWeight,
          ].filter(Boolean);

          return `    <item>\n${offerLines.join('\n')}\n    </item>`;
        });

      return [baseItem, ...offerItems].join('\n');
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(brandName)} - Product Feed</title>
    <link>${escapeXml(normalizedBaseUrl)}</link>
    <description>Product feed for ${escapeXml(brandName)}</description>
${items}
  </channel>
</rss>`;
}

export { normalizeFeedVariantStringAttributes } from './normalize-feed-variant-string-attributes';
