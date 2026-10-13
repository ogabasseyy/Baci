import { headers } from 'next/headers';
import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { ProductSemanticSections } from '@/components/storefront/ogabassey/seo/product-semantic-sections';
import { PdpRepairDeviceLink } from '@/components/storefront/repairs/PdpRepairDeviceLink';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  getCachedProductRatingStats,
  getCachedProductReviews,
} from '@/lib/cached-data';
import { isKorapayConfigured } from '@/lib/korapay';
import { isPaystackConfigured } from '@/lib/paystack';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  buildStorefrontAcceptedPaymentMethods,
  generateBreadcrumbSchema,
  generateFAQSchema,
  generateProductSchema,
  generateSlug,
  getValidatedProductUrl,
} from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { buildProductContextParagraphs } from '@/lib/storefront-product/build-product-context-paragraphs';
import { buildProductSemanticModel } from '@/lib/storefront-product/build-product-semantic-model';
import { loadCategoryScopedSemanticInventorySafely } from '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely';
import { resolveStorefrontProductCategoryName } from '@/lib/storefront-product-category-name';
import { buildProductPriceSeoCopy } from '@/lib/storefront-product-price-seo';
import { isUnsupportedSpecValue } from '@/lib/storefront-specs/is-unsupported-spec-value';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import type { FAQItem } from '@/types/faq';
import ProductDetailClient from './product-detail-client';
import type { ProductPageRuntimeProps } from './product-page-types';
import { buildProductReviewEnhancementSchema } from './product-review-enhancement-schema';

/**
 * Critical PDP shell. Everything here renders from the already-resolved
 * `product`/`merchant` with NO await on reviews, semantic inventory, guide
 * posts or the repairs catalogue, so the core product, the LCP image and the
 * price/availability (offers) JSON-LD are never blocked by optional
 * enrichment. The enrichment — the SEO semantic link graph, guides, the live
 * review structured data and the repair-device link — streams below the
 * visible shell in ProductPageBelowFold.
 */
export async function ProductPageRuntime({
  merchant,
  product,
  slug,
}: ProductPageRuntimeProps) {
  const resolvedCategoryName = resolveStorefrontProductCategoryName(product);
  const categoryName = resolvedCategoryName || 'All Products';
  const categorySlug =
    [product.categories?.slug, product.category_slug]
      .map((value) => value?.trim())
      .find((value) => value && !isUnsupportedSpecValue(value)) ??
    (resolvedCategoryName ? generateSlug(resolvedCategoryName) : 'products');
  const baseUrl = buildRequestScopedStoreUrl(merchant, await headers());
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  const productUrl = getValidatedProductUrl(product, baseUrl, merchant.slug);

  // Built from `product` alone: carries offers (price/availability) and product
  // identity for crawlers on the critical path. Live review signals
  // (aggregateRating + review) are NOT inlined here — they stream below as a
  // url-matched enhancement so this block never awaits the reviews query.
  const productSchema = generateProductSchema(
    product,
    merchant.business_name || 'Baci Store',
    currency,
    merchant.country || 'NG',
    merchant.logo_url,
    trustProfile,
    {
      acceptedPaymentMethods: buildStorefrontAcceptedPaymentMethods(merchant, {
        korapayConfigured: isKorapayConfigured(),
        paystackConfigured: isPaystackConfigured(),
        currency,
      }),
      productUrl,
    }
  );

  const categoryUrl = `${baseUrl}/${categorySlug}`;
  const breadcrumbItems = [
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: categoryName, url: categoryUrl },
    { name: product.name, url: productUrl },
  ];
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);
  const productFaqs = (product as unknown as { faqs?: FAQItem[] }).faqs;
  const faqSchema =
    productFaqs && productFaqs.length > 0
      ? generateFAQSchema(productFaqs)
      : null;

  return (
    <>
      <JsonLd data={productSchema} />
      <JsonLd data={breadcrumbSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}
      <ProductDetailClient product={product} faqs={productFaqs} />
      {/* Optional SEO enrichment, live review structured data and the repairs
          link stream BELOW the already-rendered product shell. fallback={null}
          is safe: this content appends beneath the visible PDP/LCP shell, so it
          never hides or shifts it (matches the canonical categorized PDP's
          semantic-section boundary). */}
      <Suspense fallback={null}>
        <ProductPageBelowFold
          baseUrl={baseUrl}
          categoryName={categoryName}
          categorySlug={categorySlug}
          currency={currency}
          merchant={merchant}
          product={product}
          productUrl={productUrl}
          slug={slug}
        />
      </Suspense>
    </>
  );
}

interface ProductPageBelowFoldProps {
  baseUrl: string;
  categoryName: string;
  categorySlug: string;
  currency: string;
  merchant: ProductPageRuntimeProps['merchant'];
  product: ProductPageRuntimeProps['product'];
  productUrl: string;
  slug: string;
}

/**
 * Deferred, non-critical PDP enrichment. Its reviews/inventory/guide/repairs
 * reads are degradable and MUST stay below the critical shell's Suspense
 * boundary so a slow or failed optional read never blocks or 404s the core
 * product page.
 *
 * Exported so integration tests can pre-await it directly: React's client
 * renderer (used by @testing-library/react) cannot invoke async components as
 * JSX, only the RSC server renderer can.
 */
export async function ProductPageBelowFold({
  baseUrl,
  categoryName,
  categorySlug,
  currency,
  merchant,
  product,
  productUrl,
  slug,
}: ProductPageBelowFoldProps) {
  const supportedClusterCategory =
    categorySlug in CONTENT_CLUSTER_SUPPORT
      ? (categorySlug as SupportedClusterCategory)
      : null;
  const [reviewStats, recentReviews, scopedInventory, guidePosts] =
    await Promise.all([
      getCachedProductRatingStats(product.id),
      getCachedProductReviews(product.id, { limit: 10 }),
      loadCategoryScopedSemanticInventorySafely({
        merchantId: merchant.id,
        categorySlug,
        storeSlug: slug,
        warningMessage: 'Failed to load PDP semantic inventory',
      }),
      supportedClusterCategory
        ? loadPublishedClusterPostsSafely(merchant.id, {
            pageKind: 'product',
            categorySlug: supportedClusterCategory,
            brands: product.brand ? [product.brand] : undefined,
            productNames: [product.name],
            productSlugs: product.slug ? [product.slug] : undefined,
          })
        : Promise.resolve([]),
    ]);

  const reviewEnhancementSchema = buildProductReviewEnhancementSchema({
    productName: product.name,
    productUrl,
    reviewStats,
    recentReviews,
  });

  // buildProductSemanticModel normalizes each candidate via
  // `category_slug ?? categorySlug`, then keeps only candidates whose
  // category_slug === categorySlug. The old getCachedCategoryPageData rows
  // carried NO category_slug (there is no such column and the PDP never
  // normalized them), so every product — including child-category products in a
  // parent-category scope — normalized to the current category and survived that
  // filter. Pin category_slug to the requested category here to preserve that
  // exact pool; without it, child products keep their real (child) slug and get
  // dropped from the PDP link graph (verified regression, e.g. a `laptops` PDP
  // would drop its `gaming-laptops` alternatives). The blog consumer keeps the
  // real per-product category_slug (it uses it for hrefs, not a filter).
  const inventoryCandidates = scopedInventory.isCollection
    ? []
    : scopedInventory.products.map((candidate) => ({
        ...candidate,
        category_slug: categorySlug,
      }));
  const currentProduct = {
    slug: product.slug || String(product.id),
    name: product.name,
    brand: product.brand,
    condition: product.condition,
    price: product.price,
    stock: product.stock,
    category_slug: product.category_slug ?? categorySlug,
    product_key_specs: product.product_key_specs,
  };
  const semanticModel = buildProductSemanticModel({
    storeUrl: baseUrl,
    merchantBusinessName: merchant.business_name || 'Baci Store',
    categorySlug,
    categoryName,
    countryCode: merchant.country,
    currentProduct,
    inventory: inventoryCandidates,
    guidePosts,
  });
  const priceSeoCopy = buildProductPriceSeoCopy({
    product,
    merchantDisplayName: merchant.business_name || 'Baci Store',
    categoryName,
    currency,
    country: merchant.country,
  });

  // Awaited directly (not rendered as `<PdpRepairDeviceLink />`) because this
  // is an async component: React's client renderer (used by
  // @testing-library/react in tests) cannot invoke async components as JSX,
  // only the RSC server renderer can — matching how this function itself is
  // pre-awaited in tests instead of rendered as JSX.
  const repairDeviceLink = await PdpRepairDeviceLink({
    basePath: getStorefrontPathPrefix(await headers(), merchant),
    merchant,
    productId: product.id,
  });

  return (
    <>
      {reviewEnhancementSchema && <JsonLd data={reviewEnhancementSchema} />}
      <ProductSemanticSections
        model={{
          ...semanticModel,
          contextParagraphs: buildProductContextParagraphs({
            categoryName,
            categorySlug,
            currentProduct,
            displayPriceText: priceSeoCopy.priceText,
            merchantBusinessName: merchant.business_name || 'Baci Store',
            semanticModel,
          }),
        }}
      />
      {repairDeviceLink}
    </>
  );
}
