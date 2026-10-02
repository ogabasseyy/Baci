import '@/app/(storefront)/storefront-pdp-critical.css';
import '@/app/(storefront)/storefront-pdp-description-critical.css';
import '@/app/(storefront)/storefront-pdp-semantic.css';
import {
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
} from '@baci/shared/lib';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache, type ReactNode, Suspense } from 'react';
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
import { normalizeProductConditionOffers } from '@/components/storefront/ogabassey/pdp/normalize-product-condition-offers';
import { OgabasseyPdpServerPrimaryDetails } from '@/components/storefront/ogabassey/pdp/server-primary-details';
import { buildOgabasseyProductSpecData } from '@/components/storefront/ogabassey/product-spec-data';
import { SemanticSectionsErrorBoundary } from '@/components/storefront/ogabassey/seo/semantic-sections-error-boundary';
import {
  normalizeProductCondition,
  type Product as OgabasseyProduct,
} from '@/components/storefront/ogabassey/types';
import type { VariantAttributeSource } from '@/components/storefront/ogabassey/variant-attributes';
import {
  getRenderableVariantAxes,
  mergeVariantAxisOptions,
  normalizeVariantAttributes,
} from '@/components/storefront/ogabassey/variant-attributes';
import { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  type CachedLegacyProductRedirectTarget,
  type CachedMerchant,
  type CachedProductLcpHint,
  getCachedLegacyProductRedirectTarget,
  getCachedProductLcpHint,
  getCachedProductWithDetails,
  getRequestScopedMerchant,
  sanitizeLookupLogValue,
} from '@/lib/cached-data';
import { getCachedProductLcpHintPrimaryImage } from '@/lib/cached-product-lcp-hint-primary-image';
import type { CurrencyConfig } from '@/lib/currency';
import { isKorapayConfigured } from '@/lib/korapay';
import { normalizeStorefrontCategorySlug } from '@/lib/normalize-storefront-category-slug';
import { getKnownOgaBasseyMerchantId } from '@/lib/ogabassey-route-identity';
import { isPaystackConfigured } from '@/lib/paystack';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product, ProductCondition } from '@/lib/products';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  buildStorefrontAcceptedPaymentMethods,
  generateBreadcrumbSchema,
  generateProductSchema,
  generateSlug,
  getProductUrl,
  getValidatedProductUrl,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { stripVolatileProductPriceSentences } from '@/lib/storefront-product-description';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { buildCategoryProductMetadata } from './category-product-metadata';
import {
  getInitialCriticalVariantSelection,
  getInitialCriticalVariantSelectionPrimaryImage,
  getVariantPrimaryImage,
  normalizeRouteProductVariants,
  shouldRedirectVariantSelectionParams,
} from './critical-variant-selection';
import { buildLcpRouteProductProjection } from './lcp-route-product-projection';
import { OgabasseyPdpRequestScopedSemanticSections } from './ogabassey-pdp-request-scoped-semantic-sections';
import { getPdpPriceFormatter } from './pdp-price-formatter';
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

/**
 * Converts server-side Product to Ogabassey template format
 */
function toOgabasseyProduct(
  product: Product,
  currency: CurrencyConfig
): OgabasseyProduct {
  // Format price in the merchant's own currency AND locale
  const formatter = getPdpPriceFormatter(currency);

  // Production data currently stores variant_attributes as either:
  // 1. a legacy object map { Storage: ['256GB'] }
  // 2. an array of { param: 'storage', options: ['256GB'] }
  // Normalize both shapes before building storefront selectors.
  const rawVariantAttributes = (product as { variant_attributes?: unknown })
    .variant_attributes as VariantAttributeSource;
  const normalizedVariantAttributes =
    normalizeVariantAttributes(rawVariantAttributes);
  const mergedVariantAxisOptions = mergeVariantAxisOptions(
    product.variants,
    rawVariantAttributes,
    product.condition
  );
  const { detailedSpecs, specs } = buildOgabasseyProductSpecData({
    ...product,
    variant_attributes: normalizedVariantAttributes,
  });

  // Derive storage options - check multiple sources
  // Priority: explicit storage_options > normalized variant attributes > variants
  const storageOptions =
    product.storage_options && product.storage_options.length > 0
      ? product.storage_options
      : mergedVariantAxisOptions.storage || [];

  // Compute attributeAxes from both denormalized metadata and actual variants.
  // This keeps selectors visible even when variant rows are incomplete, while still
  // allowing public storefront queries to enrich pricing/availability once RLS permits them.
  const attributeAxes = getRenderableVariantAxes(
    product.variants,
    rawVariantAttributes,
    product.condition
  );

  return {
    id: product.id,
    merchantId: product.merchant_id,
    slug: product.slug,
    name: product.name,
    price: formatter.format(product.price),
    rawPrice: product.price,
    image: product.imageLarge || product.image,
    // Handle both string arrays and object arrays with url property
    images:
      product.images?.map((img) => (typeof img === 'string' ? img : img.url)) ||
      [product.imageLarge || product.image].filter(Boolean),
    description: product.description,
    rating: product.rating ?? 0,
    // Use category from Product which is already resolved from join or TEXT field
    category: product.categories?.name || product.category || 'General',
    categorySlug: product.category_slug,
    condition: (product.condition || 'new') as OgabasseyProduct['condition'],
    brand: product.brand,
    stock: product.stock,
    manage_stock: product.manage_stock,
    // Storage options for variant selection UI
    storage: storageOptions,
    // Colors for variant selection UI
    colors: product.colors,
    // Consolidated variant attributes for Platform/etc selectors
    variant_attributes: normalizedVariantAttributes,
    // Dynamic variant axes for generic selector rendering
    attributeAxes: attributeAxes.length > 0 ? attributeAxes : undefined,
    detailedSpecs,
    specs,
    // Phase 4: Pass variants to frontend with mapping
    // Variants use attributes JSONB: {"storage": "128GB", "color": "Black", "platform": "EU"}
    variants:
      product.variants?.map(
        (v: {
          id: string;
          sku?: string;
          attributes?: Record<string, string>;
          condition?: string | null;
          price_override?: number;
          price_modifier?: number;
          inventory_tracking_policy?: string | null;
          primary_image?: string | null;
          stock_quantity?: number;
          images?: string[];
        }) => {
          const storage = v.attributes?.storage;
          const ram = v.attributes?.ram;
          const color = v.attributes?.color;
          const platform = v.attributes?.platform;

          return {
            id: v.id,
            name: `${storage || ''} ${ram || ''}`.trim() || v.sku || 'Variant',
            storage,
            ram,
            color,
            condition: normalizeProductCondition(v.condition),
            platform,
            attributes: v.attributes,
            price_override: v.price_override,
            price_modifier: v.price_modifier,
            inventory_tracking_policy: v.inventory_tracking_policy,
            primary_image: v.primary_image,
            // Keep legacy `stock` and canonical `stock_quantity` consumers in sync.
            stock: v.stock_quantity,
            stock_quantity: v.stock_quantity,
            images: v.images,
          };
        }
      ) || [],
    // Phase 5: Condition offers for consolidated products
    has_condition_offers: product.has_condition_offers,
    offers: normalizeProductConditionOffers(product.offers, (value) =>
      formatter.format(value)
    ),
  };
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

type CategoryProductResult =
  | {
      product: Product;
      categoryMismatch: boolean;
      merchant: CachedMerchant;
      needsValuesRedirect: boolean;
    }
  | {
      merchant: CachedMerchant;
      legacyRedirectTarget: CachedLegacyProductRedirectTarget;
    }
  | null;

export interface LcpRouteProduct {
  base_price?: number | null;
  baseImage?: string;
  brand: string;
  canonical_url?: string;
  categories?: { name?: string; slug?: string } | null;
  category?: string;
  category_slug?: string;
  color?: string;
  condition?: ProductCondition;
  compare_at_price?: number;
  default_variant_id?: string;
  description: string;
  gtin: string;
  has_variant_matrix?: boolean;
  has_variants?: boolean;
  id: string;
  image: string;
  imageHint: string;
  imageLarge: string;
  keywords?: string[];
  manage_stock: boolean;
  max_variant_price?: number;
  meta_description?: string;
  meta_title?: string;
  min_variant_price?: number;
  mpn: string;
  name: string;
  offers?: Array<{
    id: string;
    condition: ProductCondition;
    price: number;
    status?: string | null;
    stock_quantity: number;
  }>;
  price?: number | null;
  sale_price?: number | null;
  schema_markup?: Product['schema_markup'];
  slug?: string;
  status: Product['status'];
  stock: number;
  stock_quantity?: number | null;
  updated_at?: string | null;
  variant_attributes?: unknown;
  variants?: Product['variants'];
}

type CategoryProductRouteControlResult =
  | {
      product: LcpRouteProduct;
      categoryMismatch: boolean;
      merchant: CachedMerchant;
      needsValuesRedirect: boolean;
    }
  | {
      merchant: CachedMerchant;
      legacyRedirectTarget: CachedLegacyProductRedirectTarget;
    };

interface CategoryProductRouteControl {
  result: CategoryProductRouteControlResult;
  loadProductResult: () => Promise<CategoryProductResult>;
}

interface StartedKnownOgaBasseyPdpProductPreload {
  isKnownOgaBasseyCustomDomain: boolean;
  knownOgaBasseyImageLcpHintPromise: Promise<CachedProductLcpHint | null> | null;
  productSlug: string;
}

type CategorizedPdpLcpHint = CachedProductLcpHint & {
  status?: string | null;
};

function hasCategoryMismatch(
  productCategorySlug: string | null | undefined,
  urlCategorySlug: string
) {
  const normalizedProductCategorySlug =
    normalizeStorefrontCategorySlug(productCategorySlug);
  const normalizedUrlCategorySlug =
    normalizeStorefrontCategorySlug(urlCategorySlug);

  return Boolean(
    normalizedProductCategorySlug &&
      normalizedProductCategorySlug !== normalizedUrlCategorySlug
  );
}

function getMappedProductCategorySlug(product: LcpRouteProduct) {
  return (
    product.category_slug ||
    (product.category ? generateSlug(product.category) : null)
  );
}

function isUuidProductRouteValue(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function shouldRedirectResolvedProductSlugValue(
  productSlug: string,
  resolvedSlug: string | null | undefined
) {
  return (
    !isUuidProductRouteValue(productSlug) &&
    Boolean(resolvedSlug) &&
    resolvedSlug !== productSlug &&
    resolvedSlug?.toLowerCase() === productSlug.toLowerCase()
  );
}

function getDirectProductPreloadKey(src: string): string {
  return `direct:${src}`;
}

function parseRouteProductNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getLcpRouteLegacyPrices(cachedProduct: CachedProductLcpHint) {
  const price = parseRouteProductNumber(cachedProduct.price);
  const compareAtPrice = parseRouteProductNumber(
    cachedProduct.compare_at_price
  );
  const hasSale =
    price !== null && compareAtPrice !== null && compareAtPrice > price;

  return {
    basePrice: hasSale ? compareAtPrice : (price ?? compareAtPrice),
    compareAtPrice,
    price: price ?? compareAtPrice,
    salePrice: hasSale ? price : null,
  };
}

function getRouteVariantResolutionProduct(
  cachedProduct: CachedProductLcpHint,
  variants: NonNullable<Product['variants']>
) {
  const legacyPrices = getLcpRouteLegacyPrices(cachedProduct);
  const normalizedVariants = normalizeRouteProductVariants(variants);

  return {
    compare_at_price: legacyPrices.compareAtPrice,
    condition: normalizeProductCondition(cachedProduct.condition),
    manage_stock: cachedProduct.manage_stock,
    price: legacyPrices.price ?? legacyPrices.basePrice ?? 0,
    variants: normalizedVariants,
  };
}

function getInitialRouteVariant(
  cachedProduct: CachedProductLcpHint,
  variants: NonNullable<Product['variants']>
) {
  const resolutionProduct = getRouteVariantResolutionProduct(
    cachedProduct,
    variants
  );

  // Match the critical commerce default: open on the GLOBAL cheapest variant,
  // ignoring product.default_variant_id (the SKU projection's condition-first
  // default), so the early LCP preload hint targets the same image the PDP
  // renders instead of racing it and forcing a second preload.
  return (
    resolveLowestPricedVariantSelection(resolutionProduct)?.variant ??
    resolveDefaultVariantSelection(resolutionProduct)?.variant ??
    null
  );
}

function getCachedProductRoutePrimaryImage(
  cachedProduct: CachedProductLcpHint | null,
  variants?: NonNullable<Product['variants']>
) {
  if (!cachedProduct) {
    return null;
  }

  const normalizedVariants =
    variants ??
    normalizeStorefrontProductVariants(cachedProduct.product_variants, {
      merchantId: cachedProduct.merchant_id || OGABASSEY_MERCHANT_ID,
      productId: cachedProduct.id,
    });
  const initialVariant = getInitialRouteVariant(
    cachedProduct,
    normalizedVariants
  );

  return (
    getVariantPrimaryImage(initialVariant) ||
    getCachedProductLcpHintPrimaryImage(cachedProduct)
  );
}

function mapCachedProductLcpHintToRouteProduct(
  cachedProduct: CategorizedPdpLcpHint
): LcpRouteProduct {
  const rawCanonicalCategory = cachedProduct.categories;
  const canonicalCategory = Array.isArray(rawCanonicalCategory)
    ? rawCanonicalCategory[0]
    : rawCanonicalCategory;
  const rawFallbackCategory = cachedProduct.product_categories?.[0]?.categories;
  const fallbackCategory = Array.isArray(rawFallbackCategory)
    ? rawFallbackCategory[0]
    : rawFallbackCategory;
  const primaryCategory = canonicalCategory ?? fallbackCategory;
  const legacyPrices = getLcpRouteLegacyPrices(cachedProduct);
  const manageStock = cachedProduct.manage_stock ?? true;
  const effectiveStock = getEffectiveStock(cachedProduct);
  const canUseDenormalizedVariantPrices = manageStock === false;
  const variants = normalizeStorefrontProductVariants(
    cachedProduct.product_variants,
    {
      merchantId: cachedProduct.merchant_id || OGABASSEY_MERCHANT_ID,
      productId: cachedProduct.id,
    }
  );
  const primaryImage =
    getCachedProductRoutePrimaryImage(cachedProduct, variants) || '';
  const baseImage = getCachedProductLcpHintPrimaryImage(cachedProduct) || '';
  const {
    condition: productCondition,
    hasVariantMatrix,
    offers,
  } = buildLcpRouteProductProjection({
    condition: cachedProduct.condition,
    product_offers: cachedProduct.product_offers,
    product_variants: cachedProduct.product_variants,
  });

  return {
    base_price: legacyPrices.basePrice,
    baseImage,
    brand: cachedProduct.brand ?? '',
    canonical_url: cachedProduct.canonical_url ?? undefined,
    categories: primaryCategory,
    category: primaryCategory?.name ?? cachedProduct.category ?? undefined,
    category_slug: primaryCategory?.slug,
    color: cachedProduct.color ?? undefined,
    condition: productCondition,
    compare_at_price: legacyPrices.compareAtPrice ?? undefined,
    default_variant_id: cachedProduct.default_variant_id ?? undefined,
    description: cachedProduct.meta_description ?? '',
    gtin: '',
    has_variants: Boolean(cachedProduct.has_variants) || variants.length > 0,
    has_variant_matrix: hasVariantMatrix,
    id: cachedProduct.id,
    keywords: cachedProduct.keywords ?? undefined,
    image: primaryImage,
    imageHint: cachedProduct.name,
    imageLarge: primaryImage,
    manage_stock: manageStock,
    max_variant_price: canUseDenormalizedVariantPrices
      ? (parseRouteProductNumber(cachedProduct.max_variant_price) ?? undefined)
      : undefined,
    meta_description: cachedProduct.meta_description ?? undefined,
    meta_title: cachedProduct.meta_title ?? undefined,
    min_variant_price: canUseDenormalizedVariantPrices
      ? (parseRouteProductNumber(cachedProduct.min_variant_price) ?? undefined)
      : undefined,
    mpn: '',
    name: cachedProduct.name,
    offers,
    price: legacyPrices.price,
    sale_price: legacyPrices.salePrice,
    schema_markup: cachedProduct.schema_markup as Product['schema_markup'],
    slug: cachedProduct.slug ?? cachedProduct.id,
    status: cachedProduct.status === 'active' ? 'active' : 'archived',
    stock: effectiveStock,
    stock_quantity: effectiveStock,
    updated_at: cachedProduct.updated_at,
    variant_attributes: cachedProduct.variant_attributes,
    variants,
  };
}

function buildCriticalCommerceRouteProduct(product: LcpRouteProduct): Product {
  return {
    ...product,
    compare_at_price: product.compare_at_price ?? undefined,
    description: stripVolatileProductPriceSentences(product.description),
    max_variant_price: product.max_variant_price ?? undefined,
    min_variant_price: product.min_variant_price ?? undefined,
    price: product.price ?? 0,
  };
}

const getProductForMerchant = async (
  merchant: CachedMerchant,
  categorySlug: string,
  productSlug: string
): Promise<CategoryProductResult> => {
  // 2. Get Product using the new cached function with full joins
  // The bounded PDP snapshot normalizes the identifier inside PostgreSQL, so
  // mixed-case requests resolve in this one call and still redirect below to
  // the stored canonical slug. Do not add a second application retry owner.
  const product = await getCachedProductWithDetails(merchant.id, productSlug);

  if (!product) {
    const legacyRedirectTarget = await getCachedLegacyProductRedirectTarget(
      merchant.id,
      productSlug
    );

    if (legacyRedirectTarget) {
      return {
        merchant,
        legacyRedirectTarget,
      };
    }

    return null;
  }

  const needsValuesRedirect = shouldRedirectResolvedProductSlugValue(
    productSlug,
    product.slug
  );

  // 3. Process category data
  interface ProductWithCategory {
    categories?: {
      id: string;
      name: string;
      slug: string;
      parent_id?: string;
    } | null;
  }
  const productWithCat = product as unknown as ProductWithCategory;
  const joinedCategory = productWithCat.categories;

  const dbCategorySlug = joinedCategory?.slug;
  const dbCategoryName = joinedCategory?.name || product.category;

  // Normalize the images array from the database (JSON column stored as string or object array).
  // Guard against both non-array values and empty arrays so primaryImage always resolves.
  const rawImages = Array.isArray(product.images)
    ? (product.images as Array<string | { url: string; alt?: string }>)
    : [];
  const normalizedImages = rawImages.map((image, index) =>
    typeof image === 'string'
      ? { url: image, alt: product.name, order: index }
      : {
          url: image.url,
          alt: image.alt || product.name,
          order: index,
        }
  );
  const primaryImage = normalizedImages[0]?.url || '/placeholder.png';
  const rawVariantAttributes = (product as { variant_attributes?: unknown })
    .variant_attributes as VariantAttributeSource;
  const normalizedVariantAttributes =
    normalizeVariantAttributes(rawVariantAttributes);

  // Create extended product with category info.
  // Default `manage_stock` to `true` so legacy rows with `null` are treated as
  // managed inventory. Treating missing values as `false` would make
  // `generateProductSchema` advertise them as `InStock` regardless of actual
  // stock, which regresses historical data. See seo-utils
  // `getProductAvailability` — `manage_stock === false` short-circuits to
  // InStock.
  const manageStock = product.manage_stock ?? true;

  const productWithCategorySlug: Product = {
    ...product,
    product_key_specs:
      product.product_key_specs as unknown as Product['product_key_specs'],
    description: product.description || '',
    price:
      typeof product.price === 'string'
        ? Number.parseFloat(product.price) || 0
        : product.price,
    compare_at_price:
      typeof product.compare_at_price === 'string'
        ? Number.parseFloat(product.compare_at_price) || undefined
        : product.compare_at_price,
    manage_stock: manageStock,
    stock: getEffectiveStock(product),
    image: primaryImage,
    imageLarge: primaryImage,
    imageHint: product.imageHint || product.name,
    images: normalizedImages,
    variant_attributes: normalizedVariantAttributes,
    fulfillmentFields: product.fulfillmentFields || [],
    category: dbCategoryName || product.category,
    category_slug: dbCategorySlug,
    // Filter offers to exclude main product condition
    offers: product.product_offers?.filter((offer) => {
      const offerCondition = normalizeProductCondition(offer.condition);
      const productCondition = normalizeProductCondition(product.condition);
      return (
        offerCondition !== undefined &&
        offerCondition !== productCondition &&
        offer.status === 'active'
      );
    }),
    // Map variants
    variants: normalizeStorefrontProductVariants(product.product_variants, {
      merchantId: product.merchant_id || merchant.id,
      productId: product.id,
    }),
    has_variant_matrix:
      Array.isArray(product.product_variants) &&
      product.product_variants.length > 0,
  } as unknown as Product;

  const productCategorySlug =
    dbCategorySlug ||
    (product.category ? generateSlug(product.category) : null);

  // Compare normalized slugs so alias remaps (e.g. samsung -> smartphones) don't
  // trigger a redirect loop between the canonical URL and the raw DB slug.
  const categoryMismatch = hasCategoryMismatch(
    productCategorySlug,
    categorySlug
  );

  return {
    product: productWithCategorySlug,
    categoryMismatch,
    merchant,
    needsValuesRedirect,
  };
};

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

const getProductRouteControl = cache(
  async (
    storeSlug: string,
    categorySlug: string,
    productSlug: string
  ): Promise<CategoryProductRouteControl | null> => {
    // Over-long / repeatedly-encoded bot slugs can never match a product; bail
    // before any `'use cache'`/Supabase lookup runs with an unbounded key.
    if (!evaluateStorefrontSlugSafety(productSlug).safe) {
      console.warn(
        'Skipped product route lookups for unsafe product slug:',
        sanitizeLookupLogValue(productSlug)
      );
      return null;
    }

    const merchant = await getRequestScopedMerchant(storeSlug);

    if (!merchant) {
      console.warn(
        'Merchant not found for storefront product route:',
        storeSlug
      );
      return null;
    }

    const cachedProduct = await getCachedProductLcpHint(
      merchant.id,
      productSlug,
      {
        includeVariants: true,
      }
    );
    if (!cachedProduct) {
      const result = await getProductForMerchant(
        merchant,
        categorySlug,
        productSlug
      );
      return result
        ? {
            result,
            loadProductResult: () => Promise.resolve(result),
          }
        : null;
    }

    const product = mapCachedProductLcpHintToRouteProduct(cachedProduct);
    const needsValuesRedirect = shouldRedirectResolvedProductSlugValue(
      productSlug,
      product.slug
    );
    const loadProductResult = () =>
      getProductForMerchant(merchant, categorySlug, productSlug);

    return {
      result: {
        product,
        merchant,
        categoryMismatch: hasCategoryMismatch(
          getMappedProductCategorySlug(product),
          categorySlug
        ),
        needsValuesRedirect,
      },
      loadProductResult,
    };
  }
);

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
  const derivedSpecData = buildOgabasseyProductSpecData(renderableProduct);
  const schemaProduct =
    derivedSpecData.detailedSpecs.length > 0
      ? {
          ...renderableProduct,
          specifications: derivedSpecData.detailedSpecs,
        }
      : renderableProduct;

  const productUrl = getValidatedProductUrl(
    renderableProduct,
    baseUrl,
    merchant.slug
  );

  // Generate product schema (now handles merging custom schema_markup internally)
  const productSchema = generateProductSchema(
    schemaProduct,
    merchant?.business_name || 'Baci Store',
    currency,
    merchant?.country || 'NG',
    merchant?.logo_url,
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

  // Generate breadcrumb schema with category
  // Use category_slug from product if available, otherwise generate from TEXT field
  const categorySlugForUrl =
    product.categories?.slug ||
    product.category_slug ||
    (product.category ? generateSlug(product.category) : null);

  const categoryUrl = categorySlugForUrl
    ? `${baseUrl}/${categorySlugForUrl}`
    : `${baseUrl}/products`;

  const breadcrumbItems = [
    { name: merchant?.business_name || 'Home', url: baseUrl },
    { name: renderableProduct.category || 'All Products', url: categoryUrl },
    { name: renderableProduct.name, url: productUrl },
  ];

  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);
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
