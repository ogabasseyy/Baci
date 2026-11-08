import type { Metadata } from 'next';
import { getBrandMatchedTwitterHandle } from '@/lib/brand-matched-twitter-handle';
import type { CachedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
  getValidatedProductUrl,
} from '@/lib/seo-utils';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { stripVolatileProductPriceSentences } from '@/lib/storefront-product-description';
import { buildProductPriceSeoCopy } from '@/lib/storefront-product-price-seo';
import { normalizeSeoProductText } from '@/lib/storefront-product-slug-disambiguation';
import { getStorefrontProductSocialMetadata } from '@/lib/storefront-product-social-metadata';
import { buildProductSeoDecision } from '@/lib/storefront-seo/build-product-seo-decision';
import { toProductIndexingFacts } from '@/lib/storefront-seo/to-product-indexing-facts';
import {
  DEFAULT_STORE_NAME,
  DEFAULT_STOREFRONT_SEO_CATEGORY,
} from '@/lib/storefront-seo-defaults';
import { mergeStorefrontSmartAppBannerOther } from '@/lib/storefront-smart-app-banner-metadata';
import type { LcpRouteProduct } from './category-product-lcp-projection';

export function buildCategoryProductMetadata({
  baseUrl,
  merchant,
  product,
  storeSlug,
}: {
  baseUrl: string;
  merchant: CachedMerchant;
  product: LcpRouteProduct;
  storeSlug: string;
}): Metadata {
  const canonicalUrl = getValidatedProductUrl(product, baseUrl, merchant.slug);
  const productCategoryName =
    product.categories?.name ||
    product.category ||
    DEFAULT_STOREFRONT_SEO_CATEGORY;
  const merchantDisplayName = merchant.business_name || DEFAULT_STORE_NAME;
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  const priceSeoCopy = buildProductPriceSeoCopy({
    product,
    merchantDisplayName,
    categoryName: productCategoryName,
    currency,
    country: merchant.country,
  });
  const productDescription = stripVolatileProductPriceSentences(
    product.description
  );
  const productMetaDescription = normalizeSeoProductText(
    stripVolatileProductPriceSentences(product.meta_description),
    product
  );
  const generatedSeoDescription = normalizeSeoProductText(
    priceSeoCopy.description,
    product
  );
  const productDescriptionFallback = productDescription
    ? normalizeSeoProductText(productDescription, product)
    : generatedSeoDescription;
  const seoDescriptionSource =
    productMetaDescription ||
    (priceSeoCopy.priceText
      ? generatedSeoDescription
      : productDescriptionFallback);
  const seoDescription = generateMetaDescription(seoDescriptionSource, 160, {
    minLength: 110,
    fallback: productDescriptionFallback,
  });
  const socialMetadata = getStorefrontProductSocialMetadata(
    baseUrl,
    product,
    currency
  );
  const normalizedProductMetaTitle = normalizeSeoProductText(
    product.meta_title,
    product
  );
  const normalizedGeneratedTitle = normalizeSeoProductText(
    priceSeoCopy.title,
    product
  );
  const metadataTitleSource =
    normalizedProductMetaTitle || normalizedGeneratedTitle;
  const { metadataTitle, title: metadataTitleText } =
    buildStorefrontMetadataTitle({
      title: metadataTitleSource,
      suffix: merchantDisplayName,
      fallback:
        normalizeSeoProductText(product.name, product) || productCategoryName,
    });
  const socialMedia = merchant.social_media as
    | Record<string, string>
    | undefined;
  const twitterHandle = getBrandMatchedTwitterHandle(
    merchantDisplayName,
    socialMedia?.twitter
  );
  const robots = buildProductSeoDecision(
    toProductIndexingFacts({
      isStorePublished: merchant.is_published,
      status: product.status,
      name: product.name,
      canonicalUrl,
    })
  );
  const baseRobots = getIndexableRobotsMetadata();
  const baseGoogleBot =
    typeof baseRobots === 'object' &&
    baseRobots?.googleBot &&
    typeof baseRobots.googleBot === 'object'
      ? baseRobots.googleBot
      : {};

  return {
    title: metadataTitle,
    description: seoDescription,
    keywords: product.keywords ?? undefined,
    alternates: { canonical: canonicalUrl },
    robots: {
      ...(typeof baseRobots === 'object' ? baseRobots : {}),
      index: robots.index,
      follow: true,
      googleBot: { ...baseGoogleBot, index: robots.index, follow: true },
    },
    openGraph: {
      title: metadataTitleText,
      description: seoDescription,
      images: socialMetadata.openGraphImages,
      url: canonicalUrl,
      type: 'website',
      siteName: merchant.business_name,
    },
    twitter: {
      card: 'summary_large_image',
      title: metadataTitleText,
      description: seoDescription,
      images: socialMetadata.twitterImages,
      ...(twitterHandle && { site: twitterHandle, creator: twitterHandle }),
    },
    other: mergeStorefrontSmartAppBannerOther(storeSlug, socialMetadata.other),
  };
}
