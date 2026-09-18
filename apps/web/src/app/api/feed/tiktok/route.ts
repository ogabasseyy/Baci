import { toGoogleListingCondition } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { buildFeedDescription } from '@/app/api/feed/google-merchant/build-feed-description';
import type {
  FeedMerchant,
  FeedProduct,
  ImageManifestMap,
} from '@/app/api/feed/google-merchant/feed-builder';
import { getCachedGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { collectOfferClaimedImageUrls } from '@/lib/collect-offer-claimed-image-urls';
import { getEligibleConditionOffers } from '@/lib/eligible-condition-offers';
import {
  MerchantNotFoundError,
  resolveFeedMerchant,
} from '@/lib/feed-identifier';
import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { getEffectiveStock } from '@/lib/product-stock';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import { googleMerchantFeedQuerySchema } from '@/schemas/google-merchant-feed-query';

const UNLIMITED_STOCK_QUANTITY = 9999;

interface ResolvedTikTokImages {
  additionalImageUrls: string[];
  primaryImageUrl: string;
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

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveTikTokImages(
  manifestEntries: ImageManifestMap[string] | undefined,
  excludeUrls: ReadonlySet<string> = new Set()
): ResolvedTikTokImages | null {
  const entries = manifestEntries || [];
  const primaryImageUrl = resolveGmcPrimaryImage(entries, excludeUrls);
  if (!primaryImageUrl) {
    return null;
  }

  return {
    primaryImageUrl,
    additionalImageUrls: resolveGmcAdditionalImages(entries, excludeUrls),
  };
}

function toTikTokCondition(condition?: string | null) {
  return toGoogleListingCondition(condition) || 'new';
}

function buildPriceLines(args: {
  compareAtPrice?: number | null;
  currency: string;
  price: number;
}) {
  const formattedPrice = args.price.toFixed(2);
  if (
    typeof args.compareAtPrice === 'number' &&
    args.compareAtPrice > args.price
  ) {
    return [
      `        <sale_price>${formattedPrice} ${args.currency}</sale_price>`,
      `        <price>${args.compareAtPrice.toFixed(2)} ${args.currency}</price>`,
    ];
  }

  return [`        <price>${formattedPrice} ${args.currency}</price>`];
}

function buildItemXml(args: {
  additionalImageUrls: string[];
  availability: string;
  brandName: string;
  compareAtPrice?: number | null;
  condition: string;
  currency: string;
  description: string;
  googleProductCategory?: string;
  id: string;
  imageUrl: string;
  itemGroupId: string;
  link: string;
  mpn?: string;
  gtin?: string;
  price: number;
  productType?: string | null;
  title: string;
}) {
  const additionalImagesXml = args.additionalImageUrls
    .map(
      (url) =>
        `        <additional_image_link>${escapeXml(url)}</additional_image_link>`
    )
    .join('\n');
  const lines = [
    `        <id>${escapeXml(args.id)}</id>`,
    `        <item_group_id>${escapeXml(args.itemGroupId)}</item_group_id>`,
    `        <title>${escapeXml(args.title)}</title>`,
    `        <description>${escapeXml(args.description)}</description>`,
    `        <availability>${args.availability}</availability>`,
    ...buildPriceLines({
      compareAtPrice: args.compareAtPrice,
      currency: args.currency,
      price: args.price,
    }),
    `        <link>${escapeXml(args.link)}</link>`,
    `        <image_link>${escapeXml(args.imageUrl)}</image_link>`,
    additionalImagesXml,
    `        <brand>${escapeXml(args.brandName)}</brand>`,
    `        <condition>${args.condition}</condition>`,
    args.gtin ? `        <gtin>${escapeXml(args.gtin)}</gtin>` : '',
    args.mpn ? `        <mpn>${escapeXml(args.mpn)}</mpn>` : '',
    args.productType
      ? `        <product_type>${escapeXml(args.productType)}</product_type>`
      : '',
    args.googleProductCategory
      ? `        <google_product_category>${escapeXml(args.googleProductCategory)}</google_product_category>`
      : '',
  ].filter(Boolean);

  return `    <item>\n${lines.join('\n')}\n    </item>`;
}

function generateTikTokFeed(
  products: FeedProduct[],
  merchant: FeedMerchant,
  baseUrl: string,
  imageManifest: ImageManifestMap
): string {
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  const brandName = merchant.business_name;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  const items = products
    .filter(
      (product) => product.id && product.name?.trim() && product.price > 0
    )
    .map((product) => {
      const images = resolveTikTokImages(
        imageManifest[product.id],
        collectOfferClaimedImageUrls(
          getEligibleConditionOffers(product.offers, product.condition)
        )
      );
      if (!images) {
        return null;
      }

      const stockCount = getProductStockCount(product);
      const productUrl = buildAgentProductUrl({
        baseUrl: normalizedBaseUrl,
        product,
      });

      return buildItemXml({
        additionalImageUrls: images.additionalImageUrls,
        availability: stockCount > 0 ? 'in_stock' : 'out_of_stock',
        brandName: product.brand || brandName,
        compareAtPrice: product.compare_at_price,
        condition: toTikTokCondition(product.condition),
        currency,
        description: buildFeedDescription(product),
        googleProductCategory: product.google_product_category,
        gtin: product.gtin,
        id: product.id,
        imageUrl: images.primaryImageUrl,
        itemGroupId: product.sku || product.id,
        link: productUrl,
        mpn: product.mpn,
        price: product.price,
        productType: product.categories?.name || product.category,
        title: product.name,
      });
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(brandName)} - TikTok Catalog</title>
    <link>${escapeXml(normalizedBaseUrl)}</link>
    <description>Product catalog for ${escapeXml(brandName)}</description>
${items}
  </channel>
</rss>`;
}

/**
 * TikTok Shopping Product Feed API
 *
 * Generates an XML feed compatible with TikTok Shop.
 * Images are sourced from the same verified `product_feed_images` manifest
 * used by the Google and Meta catalog feeds.
 *
 * Usage: /api/feed/tiktok?merchant_id=xxx
 * or: /api/feed/tiktok?merchant_slug=xxx
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawParams = {
    merchant_id: searchParams.get('merchant_id') || undefined,
    merchant_slug: searchParams.get('merchant_slug') || undefined,
  };

  const parsed = googleMerchantFeedQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid query parameters' },
      { status: 400 }
    );
  }

  const { merchant_id: merchantIdParam, merchant_slug: merchantSlug } =
    parsed.data;
  const identifier = merchantIdParam || merchantSlug || '';
  const isBySlug = !merchantIdParam && !!merchantSlug;

  try {
    const resolvedMerchant = await resolveFeedMerchant(identifier, isBySlug);
    const { custom_domain, imageManifest, products } =
      await getCachedGoogleMerchantFeedData(
        resolvedMerchant.id,
        resolvedMerchant.slug
      );
    const merchant = {
      ...resolvedMerchant,
      custom_domain,
    };
    const baseUrl = buildMerchantBaseUrl({
      slug: resolvedMerchant.slug,
      custom_domain,
    });

    return new NextResponse(
      generateTikTokFeed(products, merchant, baseUrl, imageManifest),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      }
    );
  } catch (error) {
    if (error instanceof MerchantNotFoundError) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    console.error('TIKTOK_FEED_GENERATION_ERROR:', error);
    return NextResponse.json(
      { error: 'Failed to generate feed' },
      { status: 500 }
    );
  }
}
