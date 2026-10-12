import '@/app/(storefront)/storefront-pdp-critical.css';
import '@/app/(storefront)/storefront-pdp-description-critical.css';
import '@/app/(storefront)/storefront-pdp-semantic.css';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { getStorefrontShellSnapshotBase } from '@/app/(storefront)/[slug]/storefront-shell-snapshot';
import { OgabasseyPdpProductLcpSkeleton } from '@/app/(storefront)/ogabassey/ogabassey-pdp-product-lcp-skeleton';
import { preloadOgabasseyPdpProductResources } from '@/app/(storefront)/ogabassey/ogabassey-pdp-product-resource-hints';
import { JsonLd } from '@/components/seo/json-ld';
import { buildOgabasseyProductVisibleSummary } from '@/components/storefront/ogabassey/pdp/build-product-visible-summary';
import { OgabasseyPdpBelowFoldIsland } from '@/components/storefront/ogabassey/pdp/client-islands';
import { createCriticalCartProduct } from '@/components/storefront/ogabassey/pdp/critical-cart-product';
import { OgabasseyPdpCriticalCommerce } from '@/components/storefront/ogabassey/pdp/critical-commerce';
import {
  OgabasseyPdpCriticalCommerceProvider,
  OgabasseyPdpCriticalCommerceSummary,
} from '@/components/storefront/ogabassey/pdp/critical-commerce.client';
import { buildOgabasseyPdpCriticalProduct } from '@/components/storefront/ogabassey/pdp/critical-product';
import { OgabasseyPdpCriticalShell } from '@/components/storefront/ogabassey/pdp/critical-shell';
import { GenericProductRouteSummary } from '@/components/storefront/ogabassey/pdp/generic-product-route-summary';
import { OgabasseyPdpServerPrimaryDetails } from '@/components/storefront/ogabassey/pdp/server-primary-details';
import { SemanticSectionsErrorBoundary } from '@/components/storefront/ogabassey/seo/semantic-sections-error-boundary';
import type { VariantAttributeSource } from '@/components/storefront/ogabassey/variant-attributes';
import {
  getRenderableVariantAxes,
  mergeVariantAxisOptions,
} from '@/components/storefront/ogabassey/variant-attributes';
import { OGABASSEY_DOMAIN } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  type CachedProductLcpHint,
  getCachedProductLcpHint,
  getRequestScopedMerchant,
  sanitizeLookupLogValue,
} from '@/lib/cached-data';
import type { CurrencyConfig } from '@/lib/currency';
import { isKorapayConfigured } from '@/lib/korapay';
import { getKnownOgaBasseyMerchantId } from '@/lib/ogabassey-route-identity';
import { isPaystackConfigured } from '@/lib/paystack';
import type { Product } from '@/lib/products';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  buildStorefrontAcceptedPaymentMethods,
  generateSlug,
  getProductUrl,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { stripVolatileProductPriceSentences } from '@/lib/storefront-product-description';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import type { CategoryProductResult } from './category-product-detail-resolution';
import {
  buildCriticalCommerceRouteProduct,
  getCachedProductRoutePrimaryImage,
} from './category-product-lcp-projection';
import { buildCategoryProductMetadata } from './category-product-metadata';
import {
  type CategoryProductRouteControl,
  getProductRouteControl,
} from './category-product-route-control';
import { buildCategoryProductStructuredData } from './category-product-structured-data';
import {
  getInitialCriticalVariantSelection,
  getInitialCriticalVariantSelectionPrimaryImage,
  shouldRedirectVariantSelectionParams,
} from './critical-variant-selection';
import { OgabasseyPdpRequestScopedSemanticSections } from './ogabassey-pdp-request-scoped-semantic-sections';
import { toOgabasseyProduct } from './ogabassey-product';
import {
  PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
  resolveProductStaticParams,
} from './product-static-params';

const CANONICAL_PRODUCT_REDIRECT_METADATA: Metadata = {
  // Replace root metadata alternates so noindex fallback pages do not inherit a canonical.
  alternates: null,
  robots: { index: false, follow: true },
};

const PRODUCT_NOT_FOUND_METADATA: Metadata = {
  title: 'Product not found',
  description: 'This product is unavailable or has moved.',
  // Replace root metadata alternates so soft-404 pages do not inherit a canonical.
  alternates: null,
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Product not found',
    description: 'This product is unavailable or has moved.',
  },
  twitter: {
    card: 'summary',
    title: 'Product not found',
    description: 'This product is unavailable or has moved.',
  },
};

function renderCategoryProductNotFoundContent(slug: string) {
  // generateMetadata keeps missing PDPs noindex/hard-not-found before render.
  // This stable body only covers render-time races after the storefront shell
  // is already streaming.
  return (
    <StorefrontRouteNotFoundContent
      backHref={isDomainIdentifier(slug) ? '/' : `/${slug}`}
      message="This product is unavailable or has moved."
      title="Product not found"
    />
  );
}

function getFirstViewportVariantAxes(
  variants: Product['variants'],
  variantAttributes: VariantAttributeSource,
  condition?: Product['condition']
) {
  return getRenderableVariantAxes(variants, variantAttributes, condition);
}

type TemplateProductRenderMode = 'full' | 'belowFold';

/**
 * Template-aware product page component
 * Renders the correct template's product page based on merchant's template_id
 */
async function renderTemplateProductPage({
  currency,
  product,
  serverPrimaryDetails,
  semanticSections,
  storeSlug,
  templateId,
}: {
  currency: CurrencyConfig;
  product: Product;
  renderMode?: TemplateProductRenderMode;
  serverPrimaryDetails: ReactNode;
  semanticSections: ReactNode;
  storeSlug: string;
  templateId?: string;
}) {
  // Ogabassey template
  if (templateId === OGABASSEY_TEMPLATE_ID) {
    const ogabasseyProduct = toOgabasseyProduct(product, currency);

    return (
      <OgabasseyPdpBelowFoldIsland
        product={ogabasseyProduct}
        semanticSections={semanticSections}
        serverPrimaryDetails={serverPrimaryDetails}
        storeSlug={storeSlug}
      />
    );
  }

  const { DefaultProductPageRenderer } = await import(
    './default-product-page-renderer'
  );

  return (
    <DefaultProductPageRenderer
      product={product}
      semanticSections={semanticSections}
    />
  );
}

interface PageProps {
  params: Promise<{
    slug: string; // Store slug (merchant)
    category: string; // Category slug
    productSlug: string; // Product slug
  }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function getCategoryProductBasePath(slug: string): '' | `/${string}` {
  return isDomainIdentifier(slug) ? '' : `/${slug}`;
}

function getRedirectTargetPath(
  storeSlug: string,
  product: {
    id: string;
    name: string;
    slug?: string;
    category?: string | null;
    categories?: { name?: string; slug?: string } | null;
    category_slug?: string;
  }
) {
  const productPath = getProductUrl(product);
  return `${getCategoryProductBasePath(storeSlug)}${productPath}` as `/${string}`;
}

function redirectInvalidVariantSelectionParams(
  storeSlug: string,
  product: Product,
  searchParams: Awaited<PageProps['searchParams']>
) {
  if (shouldRedirectVariantSelectionParams(product, searchParams)) {
    permanentRedirect(getRedirectTargetPath(storeSlug, product));
  }
}

interface StartedKnownOgaBasseyPdpProductPreload {
  isKnownOgaBasseyCustomDomain: boolean;
  knownOgaBasseyImageLcpHintPromise: Promise<CachedProductLcpHint | null> | null;
  productSlug: string;
}

function getDirectProductPreloadKey(src: string): string {
  return `direct:${src}`;
}

function startKnownOgaBasseyPdpProductPreload(
  storeSlug: string,
  productSlug: string
): StartedKnownOgaBasseyPdpProductPreload {
  const knownOgaBasseyMerchantId = getKnownOgaBasseyMerchantId(storeSlug);
  const isKnownOgaBasseyCustomDomain =
    storeSlug.trim().toLowerCase() === OGABASSEY_DOMAIN.toLowerCase();
  // The prewarm runs before route control, so it needs its own unsafe-slug
  // gate to keep unbounded bot keys out of the `'use cache'` pipeline.
  const knownOgaBasseyImageLcpHintPromise =
    knownOgaBasseyMerchantId &&
    isKnownOgaBasseyCustomDomain &&
    evaluateStorefrontSlugSafety(productSlug).safe
      ? getCachedProductLcpHint(knownOgaBasseyMerchantId, productSlug, {
          includeVariants: isKnownOgaBasseyCustomDomain,
        })
      : null;

  if (knownOgaBasseyImageLcpHintPromise) {
    void knownOgaBasseyImageLcpHintPromise.catch((error) => {
      console.warn(
        'Unable to prewarm OgaBassey PDP LCP hint:',
        sanitizeLookupLogValue(productSlug),
        error
      );
    });
  }

  return {
    isKnownOgaBasseyCustomDomain,
    knownOgaBasseyImageLcpHintPromise,
    productSlug,
  };
}

async function resolveKnownOgaBasseyPdpProductPreload(
  preload: StartedKnownOgaBasseyPdpProductPreload,
  routeControlPromise: Promise<CategoryProductRouteControl | null>
): Promise<string | null> {
  const { isKnownOgaBasseyCustomDomain, knownOgaBasseyImageLcpHintPromise } =
    preload;

  if (!knownOgaBasseyImageLcpHintPromise || !isKnownOgaBasseyCustomDomain) {
    return null;
  }

  const earlyPreloadResult = await Promise.race([
    knownOgaBasseyImageLcpHintPromise
      .then((cachedProduct) => ({
        cachedProduct,
        kind: 'lcp-hint' as const,
        primaryImage: getCachedProductRoutePrimaryImage(cachedProduct),
      }))
      .catch(() => ({
        cachedProduct: null,
        kind: 'lcp-hint' as const,
        primaryImage: null,
      })),
    routeControlPromise.then(
      () => ({ kind: 'route-ready' as const }),
      () => ({ kind: 'route-ready' as const })
    ),
  ]);

  if (
    earlyPreloadResult.kind === 'lcp-hint' &&
    earlyPreloadResult.primaryImage &&
    earlyPreloadResult.cachedProduct
  ) {
    try {
      preloadOgabasseyPdpProductResources({
        src: earlyPreloadResult.primaryImage,
      });
      return getDirectProductPreloadKey(earlyPreloadResult.primaryImage);
    } catch (error) {
      console.warn(
        'Unable to preload OgaBassey PDP resources early:',
        sanitizeLookupLogValue(preload.productSlug),
        error
      );
    }
  }

  return null;
}

export function generateStaticParams(): Promise<
  Array<{ slug: string; category: string; productSlug: string }>
> {
  return resolveProductStaticParams();
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, category, productSlug } = await params;
  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  if (productSlug === PRERENDER_PLACEHOLDER_PRODUCT_SLUG) {
    return PRODUCT_NOT_FOUND_METADATA;
  }

  // Gate only productSlug (the crash vector — it reaches `'use cache'`/Supabase
  // lookups): skip getProductRouteControl for an unsafe product slug, then fall
  // through to the shared missing-route handling below (which still runs the
  // bounded merchant existence check, so a nonexistent tenant hard-404s). The
  // category segment is NOT gated: it only feeds an in-memory string comparison
  // (hasCategoryMismatch), never a cache/DB key, so a valid product under an
  // over-long category must still reach getProductRouteControl to emit the
  // canonical-category 308 redirect instead of a soft not-found.
  const routeControl = evaluateStorefrontSlugSafety(productSlug).safe
    ? await getProductRouteControl(slug, category, productSlug)
    : null;

  if (!routeControl) {
    const merchant = await getRequestScopedMerchant(slug);

    if (!merchant) {
      notFound();
    }

    return PRODUCT_NOT_FOUND_METADATA;
  }

  // Don't redirect from generateMetadata — Next.js can't change HTTP status
  // from here and falls back to an HTML <meta refresh>, which Google indexes
  // as "Excluded by 'noindex' tag". The page component below runs the same
  // permanentRedirect() before any HTML streams, producing a real HTTP 308.
  // Return bare, noindex metadata here as a safety net for the race.
  const { result } = routeControl;

  if (!('product' in result)) {
    return CANONICAL_PRODUCT_REDIRECT_METADATA;
  }

  const { product, merchant, categoryMismatch, needsValuesRedirect } = result;

  if (categoryMismatch || needsValuesRedirect) {
    return CANONICAL_PRODUCT_REDIRECT_METADATA;
  }

  const baseUrl = buildStoreUrl(merchant);
  return buildCategoryProductMetadata({
    baseUrl,
    merchant,
    product,
    storeSlug: slug,
  });
}

interface CategoryProductPageContentProps {
  renderMode?: 'full' | 'belowFold';
  slug: string;
  searchParams: PageProps['searchParams'];
  productResultPromise: Promise<CategoryProductResult>;
}

async function getRenderableCategoryProductResult({
  slug,
  searchParams,
  productResultPromise,
}: Omit<CategoryProductPageContentProps, 'renderMode'>) {
  const result = await productResultPromise;

  if (!result) {
    notFound();
  }

  if (!('product' in result)) {
    permanentRedirect(getRedirectTargetPath(slug, result.legacyRedirectTarget));
  }

  const { product, merchant, categoryMismatch, needsValuesRedirect } = result;

  // Strict Canonical URL Enforcement:
  // 1. If we found via case-insensitive fallback -> Redirect to lowercase canonical
  // 2. If the URL category doesn't match the product's actual category -> Redirect
  if (categoryMismatch || needsValuesRedirect) {
    permanentRedirect(getRedirectTargetPath(slug, product));
  }

  const resolvedSearchParams = await searchParams;
  redirectInvalidVariantSelectionParams(slug, product, resolvedSearchParams);

  return { merchant, product };
}

async function getRequestScopedCategoryProductBasePath(
  slug: string
): Promise<'' | `/${string}`> {
  const shellSnapshotBase = await getStorefrontShellSnapshotBase(slug);

  if (!shellSnapshotBase) {
    return getCategoryProductBasePath(slug);
  }

  const { basePath } = shellSnapshotBase;

  if (typeof basePath !== 'string') {
    return getCategoryProductBasePath(slug);
  }

  if (basePath === '') {
    return '';
  }

  return basePath.startsWith('/')
    ? (basePath as `/${string}`)
    : getCategoryProductBasePath(slug);
}

async function CategoryProductPageContent({
  renderMode = 'full',
  slug,
  searchParams,
  productResultPromise,
}: CategoryProductPageContentProps) {
  const { merchant, product } = await getRenderableCategoryProductResult({
    slug,
    searchParams,
    productResultPromise,
  });

  const baseUrl = buildStoreUrl(merchant);
  const renderableProduct: Product = {
    ...product,
    description: stripVolatileProductPriceSentences(product.description),
    ...(product.meta_description && {
      meta_description: stripVolatileProductPriceSentences(
        product.meta_description
      ),
    }),
  };
  const resolvedCategorySlug =
    renderableProduct.category_slug ||
    (renderableProduct.category
      ? generateSlug(renderableProduct.category)
      : 'products');
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);
  const currencyConfig = resolveMerchantCurrencyConfig(merchant);
  // SEO copy / JSON-LD / payment methods all take the bare ISO code.
  const currency = currencyConfig.code;
  const genericRouteSummary =
    merchant.template_id !== OGABASSEY_TEMPLATE_ID ? (
      <GenericProductRouteSummary
        currency={currency}
        merchant={merchant}
        product={renderableProduct}
      />
    ) : null;
  const semanticSections = (
    // The async server component catches strict SEO-data cold-cache failures
    // before SSR can bubble to the route error boundary. This client boundary is
    // still kept for downstream hydration/render failures.
    <SemanticSectionsErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <OgabasseyPdpRequestScopedSemanticSections
          categoryName={renderableProduct.category || 'All Products'}
          categorySlug={resolvedCategorySlug}
          merchant={merchant}
          product={renderableProduct}
          storeSlug={slug}
          storeUrl={baseUrl}
        />
      </Suspense>
    </SemanticSectionsErrorBoundary>
  );
  const { derivedSpecData, productSchema, breadcrumbSchema } =
    buildCategoryProductStructuredData({
      product: renderableProduct,
      merchant,
      baseUrl,
      currency,
      trustProfile,
      acceptedPaymentMethods: buildStorefrontAcceptedPaymentMethods(merchant, {
        korapayConfigured: isKorapayConfigured(),
        paystackConfigured: isPaystackConfigured(),
        currency,
      }),
    });
  const productPage = await renderTemplateProductPage({
    currency: currencyConfig,
    product: renderableProduct,
    renderMode,
    serverPrimaryDetails: (
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={derivedSpecData.detailedSpecs}
        productName={renderableProduct.name}
      />
    ),
    semanticSections,
    storeSlug: slug,
    templateId: merchant?.template_id,
  });

  return (
    <>
      <JsonLd data={productSchema} />
      <JsonLd data={breadcrumbSchema} />
      {genericRouteSummary}

      {productPage}
    </>
  );
}

export default async function CategoryProductPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, category, productSlug } = await params;
  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  if (productSlug === PRERENDER_PLACEHOLDER_PRODUCT_SLUG) {
    return renderCategoryProductNotFoundContent(slug);
  }

  // Gate only productSlug (the crash vector — it reaches `'use cache'`/Supabase
  // lookups): skip the LCP prewarm and getProductRouteControl for an unsafe
  // product slug, keeping the bounded merchant existence check so a nonexistent
  // tenant hard-404s. The category segment is NOT gated: it only feeds an
  // in-memory string comparison (hasCategoryMismatch), never a cache/DB key, so
  // a valid product under an over-long category must still reach
  // getProductRouteControl to emit the canonical-category 308 redirect.
  if (!evaluateStorefrontSlugSafety(productSlug).safe) {
    const merchant = await getRequestScopedMerchant(slug);

    if (!merchant) {
      notFound();
    }

    return renderCategoryProductNotFoundContent(slug);
  }

  const knownOgaBasseyProductPreload = startKnownOgaBasseyPdpProductPreload(
    slug,
    productSlug
  );
  const routeControlPromise = getProductRouteControl(
    slug,
    category,
    productSlug
  );
  const preloadedProductResourceKeyPromise =
    resolveKnownOgaBasseyPdpProductPreload(
      knownOgaBasseyProductPreload,
      routeControlPromise
    );
  const routeControl = await routeControlPromise;

  if (!routeControl) {
    const merchant = await getRequestScopedMerchant(slug);

    if (!merchant) {
      notFound();
    }

    return renderCategoryProductNotFoundContent(slug);
  }

  const { result: productResult, loadProductResult } = routeControl;

  if (!('product' in productResult)) {
    permanentRedirect(
      getRedirectTargetPath(slug, productResult.legacyRedirectTarget)
    );
  }

  const { product, merchant, categoryMismatch, needsValuesRedirect } =
    productResult;

  if (categoryMismatch || needsValuesRedirect) {
    permanentRedirect(getRedirectTargetPath(slug, product));
  }

  const primaryProductImage = product.imageLarge || product.image || null;
  const criticalFallbackProductImage =
    (product as { baseImage?: string | null }).baseImage || primaryProductImage;
  const criticalProduct =
    merchant.template_id === OGABASSEY_TEMPLATE_ID
      ? buildOgabasseyPdpCriticalProduct(product)
      : null;
  // Resolved once and threaded into both the LCP critical shell's static
  // price fallback and the client commerce provider (whose live price reads
  // it back out of context) so the two price surfaces never diverge.
  const criticalCurrency = criticalProduct
    ? resolveMerchantCurrencyConfig(merchant)
    : null;
  const commerceProduct = buildCriticalCommerceRouteProduct(product);
  const visibleSummary = criticalProduct
    ? buildOgabasseyProductVisibleSummary({
        brand: product.brand,
        condition: product.condition,
        has_variant_matrix: product.has_variant_matrix,
        manage_stock: commerceProduct.manage_stock,
        name: product.name,
        variants: commerceProduct.variants,
      })
    : null;
  const resolvedSearchParams = await searchParams;
  const criticalInitialVariantSelection = criticalProduct
    ? getInitialCriticalVariantSelection(commerceProduct, resolvedSearchParams)
    : undefined;
  const selectedVariantProductImage = criticalProduct
    ? getInitialCriticalVariantSelectionPrimaryImage(
        commerceProduct,
        criticalInitialVariantSelection
      )
    : null;
  const pageOwnsProductPreload = merchant.template_id === OGABASSEY_TEMPLATE_ID;
  const pagePreloadProductImage = pageOwnsProductPreload
    ? selectedVariantProductImage || primaryProductImage
    : null;
  const pagePreloadResourceKey =
    pagePreloadProductImage !== null
      ? getDirectProductPreloadKey(pagePreloadProductImage)
      : null;
  const preloadedProductResourceKey = await preloadedProductResourceKeyPromise;
  const shouldPreloadProductImage =
    pagePreloadResourceKey !== null &&
    pagePreloadResourceKey !== preloadedProductResourceKey;

  try {
    if (shouldPreloadProductImage && pagePreloadProductImage) {
      preloadOgabasseyPdpProductResources({ src: pagePreloadProductImage });
    }
  } catch (error) {
    console.warn(
      'Unable to preload OgaBassey PDP resources early:',
      sanitizeLookupLogValue(productSlug),
      error
    );
  }

  const criticalBasePathPromise = criticalProduct
    ? getRequestScopedCategoryProductBasePath(slug)
    : Promise.resolve<'' | `/${string}`>('');
  const productResultPromise = loadProductResult();

  redirectInvalidVariantSelectionParams(
    slug,
    commerceProduct,
    resolvedSearchParams
  );
  const resolvedSearchParamsPromise = Promise.resolve(resolvedSearchParams);
  const criticalCommerceContext = criticalProduct
    ? (() => {
        const rawVariantAttributes = (
          commerceProduct as { variant_attributes?: unknown }
        ).variant_attributes as VariantAttributeSource;
        const variantCount = commerceProduct.variants?.length ?? 0;
        const variantAxisOptions = mergeVariantAxisOptions(
          commerceProduct.variants,
          rawVariantAttributes,
          commerceProduct.condition
        );

        return {
          cartProduct: createCriticalCartProduct(commerceProduct),
          initialVariantSelection: criticalInitialVariantSelection,
          product: {
            ...criticalProduct,
            variantCount,
            visibleSummary,
          },
          variantAxes: getFirstViewportVariantAxes(
            commerceProduct.variants,
            rawVariantAttributes,
            commerceProduct.condition
          ),
          variantAxisOptions,
          variantCount,
        };
      })()
    : null;

  return (
    <>
      {criticalCommerceContext ? (
        <OgabasseyPdpCriticalCommerceProvider
          cartProduct={criticalCommerceContext.cartProduct}
          currency={criticalCurrency ?? undefined}
          initialVariantSelection={
            criticalCommerceContext.initialVariantSelection
          }
          variantAxes={criticalCommerceContext.variantAxes}
          variantAxisOptions={criticalCommerceContext.variantAxisOptions}
          variantCount={criticalCommerceContext.variantCount}
        >
          <OgabasseyPdpCriticalShell
            basePath={getCategoryProductBasePath(slug)}
            basePathPromise={criticalBasePathPromise}
            currency={criticalCurrency ?? undefined}
            fallbackImage={criticalFallbackProductImage}
            product={criticalCommerceContext.product}
            summaryCommerce={<OgabasseyPdpCriticalCommerceSummary />}
          >
            <OgabasseyPdpCriticalCommerce
              cartBasePathPromise={criticalBasePathPromise}
              product={criticalCommerceContext.product}
            />
          </OgabasseyPdpCriticalShell>
          <Suspense fallback={null}>
            <CategoryProductPageContent
              renderMode="belowFold"
              slug={slug}
              searchParams={resolvedSearchParamsPromise}
              productResultPromise={productResultPromise}
            />
          </Suspense>
        </OgabasseyPdpCriticalCommerceProvider>
      ) : (
        <Suspense
          fallback={
            <OgabasseyPdpProductLcpSkeleton
              merchant={merchant}
              primaryProductImage={
                merchant.template_id === OGABASSEY_TEMPLATE_ID
                  ? primaryProductImage
                  : null
              }
              productName={product.name}
            />
          }
        >
          <CategoryProductPageContent
            renderMode="full"
            slug={slug}
            searchParams={resolvedSearchParamsPromise}
            productResultPromise={productResultPromise}
          />
        </Suspense>
      )}
    </>
  );
}
