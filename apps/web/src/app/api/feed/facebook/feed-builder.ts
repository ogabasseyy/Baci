import { toGoogleListingCondition } from '@baci/shared/lib';
import { buildFeedDescription } from '@/app/api/feed/google-merchant/build-feed-description';
import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { getEffectiveStock } from '@/lib/product-stock';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import { escapeXml } from '@/lib/xml-utils';
import { buildVariantFeedItems } from '../google-merchant/build-variant-feed-items';
import type {
  FeedMerchant,
  FeedProduct,
  ImageManifestMap,
} from '../google-merchant/feed-builder';

import {
  FEED_TITLE_MAX_LENGTH as FACEBOOK_TITLE_MAX_LENGTH,
  UNLIMITED_STOCK_QUANTITY,
} from '../google-merchant/feed-constants';

const VALID_FACEBOOK_CONDITIONS = new Set([
  'new',
  'used',
  'refurbished',
] as const);

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

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

  return (
    product.variant_model === 'sku_matrix' &&
    getSkuMatrixFallbackEligibleVariants(product).length > 0
  );
}

function isUnmanagedStock(manageStock: boolean | null | undefined): boolean {
  return manageStock === false || manageStock == null;
}

function getProductStockCount(product: FeedProduct): number {
  if (isUnmanagedStock(product.manage_stock)) {
    return UNLIMITED_STOCK_QUANTITY;
  }

  return getEffectiveStock(product);
}

function toFacebookCondition(condition?: string | null) {
  const normalized = toGoogleListingCondition(condition);
  return normalized && VALID_FACEBOOK_CONDITIONS.has(normalized)
    ? normalized
    : 'new';
}

function getProductType(product: FeedProduct): string | undefined {
  const category = product.categories?.name?.trim() || product.category?.trim();
  return category || product.category_slug?.trim() || undefined;
}

function getSkuMatrixFallbackEligibleVariants(product: FeedProduct) {
  return (product.variants || []).filter((variant) => {
    const effectivePrice =
      variant.price_override ?? variant.price ?? product.price;
    return Boolean(variant.id && variant.condition && effectivePrice > 0);
  });
}

function buildPriceLines(args: {
  compareAtPrice?: number | null;
  currency: string;
  price: number;
}) {
  const price = args.price.toFixed(2);
  if (
    typeof args.compareAtPrice === 'number' &&
    args.compareAtPrice > args.price
  ) {
    return [
      `        <g:sale_price>${price} ${args.currency}</g:sale_price>`,
      `        <g:price>${args.compareAtPrice.toFixed(2)} ${args.currency}</g:price>`,
    ];
  }

  return [`        <g:price>${price} ${args.currency}</g:price>`];
}

function buildItemXml(args: {
  additionalImagesXml: string;
  availability: string;
  brandName: string;
  compareAtPrice?: number | null;
  condition: string;
  currency: string;
  description: string;
  googleProductCategory?: string;
  id: string;
  imageUrl: string;
  link: string;
  mpn?: string;
  gtin?: string;
  price: number;
  productType?: string;
  title: string;
}) {
  const lines = [
    `        <g:id>${escapeXml(args.id)}</g:id>`,
    `        <g:item_group_id>${escapeXml(args.id)}</g:item_group_id>`,
    `        <g:title>${escapeXml(truncate(args.title, FACEBOOK_TITLE_MAX_LENGTH))}</g:title>`,
    `        <g:description>${escapeXml(args.description)}</g:description>`,
    `        <g:availability>${args.availability}</g:availability>`,
    ...buildPriceLines({
      compareAtPrice: args.compareAtPrice,
      currency: args.currency,
      price: args.price,
    }),
    `        <g:link>${escapeXml(args.link)}</g:link>`,
    `        <g:image_link>${escapeXml(args.imageUrl)}</g:image_link>`,
    args.additionalImagesXml,
    `        <g:brand>${escapeXml(args.brandName)}</g:brand>`,
    `        <g:condition>${args.condition}</g:condition>`,
    args.gtin ? `        <g:gtin>${escapeXml(args.gtin)}</g:gtin>` : '',
    args.mpn ? `        <g:mpn>${escapeXml(args.mpn)}</g:mpn>` : '',
    args.googleProductCategory
      ? `        <g:google_product_category>${escapeXml(args.googleProductCategory)}</g:google_product_category>`
      : '',
    args.productType
      ? `        <g:product_type>${escapeXml(args.productType)}</g:product_type>`
      : '',
  ].filter(Boolean);

  return `    <item>\n${lines.join('\n')}\n    </item>`;
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
      if (!toGoogleListingCondition(product.condition)) return null;
      const primaryImageUrl = resolveGmcPrimaryImage(manifestEntries);
      if (!primaryImageUrl) {
        return null;
      }

      const additionalImagesXml = resolveGmcAdditionalImages(manifestEntries)
        .map(
          (url) =>
            `        <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`
        )
        .join('\n');
      const stockCount = getProductStockCount(product);

      return buildItemXml({
        additionalImagesXml,
        availability: stockCount > 0 ? 'in stock' : 'out of stock',
        brandName: product.brand || brandName,
        compareAtPrice: product.compare_at_price,
        condition: toFacebookCondition(product.condition),
        currency,
        description: buildFeedDescription(product),
        googleProductCategory: product.google_product_category,
        gtin: product.gtin,
        id: product.id,
        imageUrl: primaryImageUrl,
        link: productUrl,
        mpn: product.mpn,
        price: product.price,
        productType: getProductType(product),
        title: product.name,
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
