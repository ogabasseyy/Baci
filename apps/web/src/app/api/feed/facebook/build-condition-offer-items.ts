import {
  normalizeCanonicalProductCondition,
  toGoogleListingCondition,
} from '@baci/shared/lib';
import { buildFeedDescription } from '@/app/api/feed/google-merchant/build-feed-description';
import { collectOfferClaimedImageUrls } from '@/lib/collect-offer-claimed-image-urls';
import { getEligibleConditionOffers } from '@/lib/eligible-condition-offers';
import {
  type FeedImageManifestEntry,
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { getEffectiveStock } from '@/lib/product-stock';
import { resolveOfferFeedImages } from '@/lib/resolve-offer-feed-images';
import { escapeXml } from '@/lib/xml-utils';
import { FEED_CONSTANTS } from '../google-merchant/feed-constants';
import { getFeedStockCount } from '../google-merchant/feed-stock';
import type { FeedProduct } from '../google-merchant/feed-types';

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

function isUnmanagedStock(manageStock: boolean | null | undefined): boolean {
  return manageStock === false || manageStock == null;
}

function getProductStockCount(product: FeedProduct): number {
  if (isUnmanagedStock(product.manage_stock)) {
    return FEED_CONSTANTS.UNLIMITED_STOCK_QUANTITY;
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
  groupId?: string;
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
    `        <g:item_group_id>${escapeXml(args.groupId || args.id)}</g:item_group_id>`,
    `        <g:title>${escapeXml(truncate(args.title, FEED_CONSTANTS.TITLE_MAX_LENGTH))}</g:title>`,
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

export function buildConditionOfferItems(args: {
  brandName: string;
  currency: string;
  manifestEntries: FeedImageManifestEntry[];
  product: FeedProduct;
  productUrl: string;
}): string {
  const { brandName, currency, manifestEntries, product, productUrl } = args;
  const eligibleOffers = getEligibleConditionOffers(
    product.offers,
    product.condition
  );
  const offerClaimedImageUrls = collectOfferClaimedImageUrls(eligibleOffers);
  const parentCondition =
    product.condition == null
      ? 'new'
      : toGoogleListingCondition(product.condition);
  const primaryImageUrl = resolveGmcPrimaryImage(
    manifestEntries,
    offerClaimedImageUrls
  );

  const additionalImagesXml = resolveGmcAdditionalImages(
    manifestEntries,
    offerClaimedImageUrls
  )
    .filter((url) => url !== primaryImageUrl)
    .map(
      (url) =>
        `        <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`
    )
    .join('\n');
  const stockCount = getProductStockCount(product);

  // Variant rows must carry an id that differs from their
  // item_group_id: qualify the base-condition row once offers group it.
  const hasConditionOffers = eligibleOffers.length > 0;
  const baseItemId =
    hasConditionOffers && parentCondition
      ? `${product.id}-${parentCondition}`
      : product.id;

  const baseArgs = {
    additionalImagesXml,
    availability: stockCount > 0 ? 'in stock' : 'out of stock',
    brandName: product.brand || brandName,
    compareAtPrice: product.compare_at_price,
    condition: toFacebookCondition(product.condition),
    currency,
    description: buildFeedDescription(product),
    googleProductCategory: product.google_product_category,
    gtin: product.gtin,
    id: baseItemId,
    groupId: hasConditionOffers ? product.id : undefined,
    imageUrl: primaryImageUrl || '',
    link: productUrl,
    mpn: product.mpn,
    price: product.price,
    productType: getProductType(product),
    title: product.name,
  };
  const base =
    primaryImageUrl &&
    parentCondition &&
    Number.isFinite(product.price) &&
    product.price > 0
      ? buildItemXml(baseArgs)
      : '';
  const offers = eligibleOffers.map((offer) => {
    const offerImages = resolveOfferFeedImages(
      offer.images,
      manifestEntries,
      offerClaimedImageUrls
    );
    if (!offerImages) return '';
    const url = new URL(productUrl);
    url.searchParams.set(
      'condition',
      normalizeCanonicalProductCondition(offer.condition) || offer.condition
    );
    return buildItemXml({
      ...baseArgs,
      ...offerImages,
      id: offer.id,
      groupId: product.id,
      price: offer.price,
      compareAtPrice: offer.compare_at_price,
      condition: toFacebookCondition(offer.condition),
      availability:
        getFeedStockCount(product, offer) > 0 ? 'in stock' : 'out of stock',
      link: url.toString(),
    });
  });
  return [base, ...offers].filter(Boolean).join('\n');
}
