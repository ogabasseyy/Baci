import '@/app/(storefront)/storefront-pdp.css';
import type { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ProductDetailRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { StorefrontRouteNotFound } from '@/app/(storefront)/[slug]/storefront-route-not-found';
import { getBrandMatchedTwitterHandle } from '@/lib/brand-matched-twitter-handle';
import { getCachedLegacyProductRedirectTarget } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
  getValidatedProductUrl,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
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
import {
  getCategorizedRedirectTarget,
  getInvalidVariantSelectionRedirectTarget,
  getRequestScopedProduct,
  resolveProductPage,
} from './product-page-resolution';
import { ProductPageRuntime } from './product-page-runtime';
import type { PageProps } from './product-page-types';

const LEGACY_PRODUCT_NOINDEX_METADATA: Metadata = {
  // Replace root metadata alternates so noindex fallback pages do not inherit a canonical.
  alternates: null,
  robots: { index: false, follow: true },
};

export async function generateMetadata(
  { params, searchParams }: PageProps,
  __parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const resolvedSearchParams = await searchParams;
  // Request-scoped (React cache()) — reuses the same Promise resolveProductPage
  // awaits below for this (slug, productSlug) pair instead of a second
  // Supabase round-trip.
  const productResult = await getRequestScopedProduct(slug, productSlug);
  if (!productResult) {
    notFound();
  }
  const { product } = productResult;
  if (!product) {
    const legacyRedirectTarget = await getCachedLegacyProductRedirectTarget(
      productResult.merchant.id,
      productSlug
    );

    if (!legacyRedirectTarget) {
      notFound();
    }

    // Don't issue a redirect from generateMetadata — Next.js can't change
    // HTTP status from here and falls back to an HTML <meta refresh>, which
    // Google indexes as a soft redirect / "noindex" page. The default page
    // component handler runs in parallel and throws permanentRedirect at the
    // pre-render stage, which produces a real HTTP 308. Returning bare,
    // noindex metadata here is a safety net for that race.
    return LEGACY_PRODUCT_NOINDEX_METADATA;
  }
  // Mirror the page-component redirect checks so we can emit noindex metadata
  // (real HTTP 308 issues from the page render — see comment above).
  if (
    getCategorizedRedirectTarget(slug, product) ||
    getInvalidVariantSelectionRedirectTarget(
      slug,
      product,
      resolvedSearchParams
    )
  ) {
    return LEGACY_PRODUCT_NOINDEX_METADATA;
  }
  const { merchant } = productResult;
  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = getValidatedProductUrl(product, baseUrl, merchant.slug);
  // Metadata needs a generic noun here; the UI uses a friendlier "All Products"
  // fallback later for visible copy when no category label exists.
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
  const generatedSeoDescription = normalizeSeoProductText(
    priceSeoCopy.description,
    product
  );
  const productMetaDescription = normalizeSeoProductText(
    product.meta_description,
    product
  );
  const seoDescription = generateMetaDescription(
    productMetaDescription || generatedSeoDescription,
    160,
    {
      minLength: 110,
      fallback: generatedSeoDescription,
    }
  );
  const socialMetadata = getStorefrontProductSocialMetadata(
    baseUrl,
    product,
    currency
  );
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
    keywords: product.keywords,
    alternates: {
      canonical: canonicalUrl,
    },
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
      ...(twitterHandle && {
        site: twitterHandle,
        creator: twitterHandle,
      }),
    },
    other: mergeStorefrontSmartAppBannerOther(slug, socialMetadata.other),
  };
}

async function RequestBoundProductPage(props: PageProps) {
  // Cache Components requires request-bound route params/search params to stay
  // behind connection() so production can emit a stable static shell first.
  await connection();
  const resolution = await resolveProductPage(props);
  if (resolution.kind === 'route-not-found') {
    return StorefrontRouteNotFound();
  }

  return ProductPageRuntime(resolution.runtimeProps);
}

export default function ProductPage(props: PageProps) {
  return (
    <Suspense fallback={<ProductDetailRouteLoading />}>
      <RequestBoundProductPage {...props} />
    </Suspense>
  );
}
