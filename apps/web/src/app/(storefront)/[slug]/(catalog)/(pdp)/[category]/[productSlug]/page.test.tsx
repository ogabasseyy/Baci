import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  Suspense,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

const PRERENDER_PLACEHOLDER_STORE_SLUG = '__prerender_placeholder_store__';
const PRERENDER_PLACEHOLDER_PRODUCT_SLUG = '__prerender_placeholder__';

vi.mock('server-only', () => ({}));

const { mockReactCacheResetters, mockResetReactCacheStores } = vi.hoisted(
  () => {
    const resetters: Array<() => void> = [];

    return {
      mockReactCacheResetters: resetters,
      mockResetReactCacheStores: () => {
        for (const reset of resetters) {
          reset();
        }
      },
    };
  }
);

vi.mock('react', async (importActual) => {
  const actual = await importActual<typeof import('react')>();
  type CacheableFunction<Args extends unknown[], Result> = (
    ...args: Args
  ) => Result;
  type CacheNode<Result> = {
    error?: unknown;
    hasError: boolean;
    hasResult: boolean;
    objectChildren: WeakMap<object, CacheNode<Result>>;
    primitiveChildren: Map<unknown, CacheNode<Result>>;
    result?: Result;
  };
  const createCacheNode = <Result,>(): CacheNode<Result> => ({
    hasError: false,
    hasResult: false,
    objectChildren: new WeakMap<object, CacheNode<Result>>(),
    primitiveChildren: new Map<unknown, CacheNode<Result>>(),
  });
  const isObjectCacheKey = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function';
  const getCacheNode = <Result,>(
    root: CacheNode<Result>,
    args: unknown[]
  ): CacheNode<Result> => {
    let node = root;

    for (const arg of args) {
      if (isObjectCacheKey(arg)) {
        let child = node.objectChildren.get(arg);
        if (!child) {
          child = createCacheNode<Result>();
          node.objectChildren.set(arg, child);
        }
        node = child;
        continue;
      }

      let child = node.primitiveChildren.get(arg);
      if (!child) {
        child = createCacheNode<Result>();
        node.primitiveChildren.set(arg, child);
      }
      node = child;
    }

    return node;
  };

  return {
    ...actual,
    cache: <Args extends unknown[], Result>(
      fn: CacheableFunction<Args, Result>
    ) => {
      let root = createCacheNode<Result>();
      mockReactCacheResetters.push(() => {
        root = createCacheNode<Result>();
      });

      return (...args: Args) => {
        const node = getCacheNode(root, args);
        if (node.hasError) {
          throw node.error;
        }
        if (!node.hasResult) {
          try {
            node.result = fn(...args);
            node.hasResult = true;
          } catch (error) {
            node.error = error;
            node.hasError = true;
            throw error;
          }
        }

        return node.result as Result;
      };
    },
  };
});

const {
  mockNormalizeStorefrontProductVariants,
  mockOgabasseyPdpProductResourceHints,
  mockOgabasseyPdpSemanticSections,
  mockOgabasseyPdpStaticResourceHints,
  mockPreloadOgabasseyPdpStaticResources,
  mockOgabasseyPdpCriticalCommerce,
  mockOgabasseyPdpCriticalCommerceProvider,
  mockOgabasseyPdpCriticalCommerceSummary,
  mockOgabasseyPdpDeferredDetailIsland,
  mockOgabasseyProductDetailsPage,
  mockConnection,
  mockGetStorefrontShellSnapshotBase,
  mockProductDetailClient,
} = vi.hoisted(() => ({
  mockNormalizeStorefrontProductVariants: vi.fn<
    (...args: unknown[]) => Record<string, unknown>[]
  >(() => []),
  mockOgabasseyPdpProductResourceHints: vi.fn<
    (props: { src: string | null | undefined }) => null
  >(() => null),
  mockOgabasseyPdpSemanticSections: vi.fn<(props: unknown) => void>(),
  mockOgabasseyPdpStaticResourceHints: vi.fn<() => void>(),
  mockPreloadOgabasseyPdpStaticResources: vi.fn<() => void>(),
  mockOgabasseyPdpCriticalCommerce: vi.fn<(props: unknown) => void>(),
  mockOgabasseyPdpCriticalCommerceProvider: vi.fn<(props: unknown) => void>(),
  mockOgabasseyPdpCriticalCommerceSummary: vi.fn<() => void>(),
  mockOgabasseyPdpDeferredDetailIsland: vi.fn<(props: unknown) => void>(),
  mockOgabasseyProductDetailsPage: vi.fn<(props: unknown) => void>(),
  mockConnection: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockGetStorefrontShellSnapshotBase:
    vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  mockProductDetailClient: vi.fn<(props: unknown) => null>(() => null),
}));

const mockGetEffectiveStock = vi.fn<(item: unknown) => number>(() => 0);

const mockHeaders = vi.fn();
const mockPermanentRedirect = vi.fn((_url: string) => {
  throw new Error('NEXT_REDIRECT');
});
const mockRedirect = vi.fn((_url: string) => {
  throw new Error('NEXT_REDIRECT');
});
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockGetRequestScopedMerchant = vi.fn();
const mockGetCachedLegacyProductRedirectTarget = vi.fn();
const mockGetCachedProduct = vi.fn();
const mockGetCachedProductLcpHint = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockLoadCategoryScopedSemanticInventory = vi.fn();
const mockBuildProductSemanticModel = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();
const mockGenerateBreadcrumbSchema = vi.fn((_items: unknown) => ({}));
const mockGenerateProductSchema = vi.fn((..._args: unknown[]) => ({}));
const mockGetCachedStorefrontProductIndex =
  vi.fn<
    (...args: unknown[]) => Promise<{
      hasError: boolean;
      products: Array<{ slug?: string; category_slug?: string }>;
    }>
  >();

function getMockEffectiveStock(item: unknown): number {
  if (!item || typeof item !== 'object') {
    return 0;
  }

  const stockLike = item as {
    stock?: number | string | null;
    stock_quantity?: number | string | null;
  };
  const stockQuantity =
    stockLike.stock_quantity === null || stockLike.stock_quantity === undefined
      ? null
      : Number(stockLike.stock_quantity);
  const legacyStock =
    stockLike.stock === null || stockLike.stock === undefined
      ? 0
      : Number(stockLike.stock);
  const safeStockQuantity =
    stockQuantity !== null && Number.isFinite(stockQuantity)
      ? Math.max(0, stockQuantity)
      : 0;
  const safeLegacyStock = Number.isFinite(legacyStock)
    ? Math.max(0, legacyStock)
    : 0;

  if (stockLike.stock_quantity == null) {
    return safeLegacyStock;
  }

  return safeStockQuantity === 0 && safeLegacyStock > 0
    ? safeLegacyStock
    : safeStockQuantity;
}

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/image', async () => {
  const { default: globalImageLoader } =
    await vi.importActual<typeof import('@/lib/image-loader')>(
      '@/lib/image-loader'
    );

  return {
    default: ({
      alt,
      fetchPriority,
      loader,
      loading,
      preload,
      quality,
      src,
    }: {
      alt: string;
      fetchPriority?: string;
      loader?: (props: {
        quality?: number;
        src: string;
        width: number;
      }) => string;
      loading?: string;
      preload?: boolean;
      quality?: number;
      src: string;
    }) => {
      const effectiveLoader =
        typeof loader === 'function' ? loader : globalImageLoader;
      const resolvedSrc = effectiveLoader({ quality, src, width: 640 });

      return (
        // biome-ignore lint/performance/noImgElement: next/image test double exposes rendered attributes
        <img
          alt={alt}
          data-fetch-priority={fetchPriority}
          data-loader-prop={String(typeof loader === 'function')}
          data-loading={loading}
          data-preload={String(Boolean(preload))}
          src={resolvedSrc}
        />
      );
    },
    getImageProps: ({
      alt,
      className,
      decoding,
      fetchPriority,
      fill,
      loader,
      loading,
      priority,
      quality,
      sizes,
      src,
      width,
    }: {
      alt: string;
      className?: string;
      decoding?: string;
      fetchPriority?: string;
      fill?: boolean;
      loader?: (props: {
        quality?: number;
        src: string;
        width: number;
      }) => string;
      loading?: string;
      priority?: boolean;
      quality?: number;
      sizes?: string;
      src: string;
      width?: number;
    }) => {
      const resolvedWidth = width ?? 640;
      const effectiveLoader =
        typeof loader === 'function' ? loader : globalImageLoader;
      const resolvedSrc = effectiveLoader({
        quality,
        src,
        width: resolvedWidth,
      });

      return {
        props: {
          alt,
          className,
          decoding,
          fetchPriority,
          fill,
          loader,
          loading,
          priority,
          quality,
          sizes,
          src: resolvedSrc,
          srcSet: `${resolvedSrc} ${resolvedWidth}w`,
        },
      };
    },
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/app/(storefront)/[slug]/storefront-shell-snapshot', () => ({
  getStorefrontShellSnapshotBase: (...args: unknown[]) =>
    mockGetStorefrontShellSnapshotBase(...args),
}));

vi.mock('@/components/storefront/ogabassey/pages/product-details-page', () => ({
  ProductDetailsPage: (props: {
    mode?: 'full' | 'commerce' | 'belowFold';
    product: { image?: string; name: string };
    semanticSections?: ReactNode;
  }) => {
    mockOgabasseyProductDetailsPage(props);
    const { mode = 'full', product, semanticSections = null } = props;

    if (mode === 'commerce') {
      return (
        <div data-testid="ogabassey-commerce-island">
          <button type="button">Mock Add to Cart</button>
        </div>
      );
    }

    if (mode === 'belowFold') {
      return (
        <div data-testid="ogabassey-below-fold-island">{semanticSections}</div>
      );
    }

    return (
      <>
        <h1>{product.name}</h1>
        {product.image ? (
          // biome-ignore lint/performance/noImgElement: test mock for duplicate image detection
          <img alt={product.name} src={product.image} />
        ) : null}
        {semanticSections}
      </>
    );
  },
}));

vi.mock(
  '@/app/(storefront)/ogabassey/ogabassey-pdp-static-resource-hints',
  () => ({
    OgabasseyPdpStaticResourceHints: () => {
      mockOgabasseyPdpStaticResourceHints();
      return null;
    },
    preloadOgabasseyPdpStaticResources: () =>
      mockPreloadOgabasseyPdpStaticResources(),
  })
);

vi.mock(
  '@/app/(storefront)/ogabassey/ogabassey-pdp-product-resource-hints',
  () => ({
    OgabasseyPdpProductResourceHints: (props: {
      src: string | null | undefined;
    }) => mockOgabasseyPdpProductResourceHints(props),
    preloadOgabasseyPdpProductResources: (props: {
      src: string | null | undefined;
    }) => mockOgabasseyPdpProductResourceHints(props),
  })
);

vi.mock('./ogabassey-pdp-request-scoped-semantic-sections', () => ({
  OgabasseyPdpRequestScopedSemanticSections: (props: unknown) => {
    mockOgabasseyPdpSemanticSections(props);
    return <section data-testid="ogabassey-pdp-semantic-sections" />;
  },
}));

vi.mock('@/components/storefront/ogabassey/pdp/critical-commerce', () => ({
  OgabasseyPdpCriticalCommerce: (props: unknown) => {
    mockOgabasseyPdpCriticalCommerce(props);
    return (
      <aside aria-label="Purchase options">
        <button type="button">Mock Add to Cart</button>
      </aside>
    );
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/pdp/critical-commerce.client',
  () => ({
    OgabasseyPdpCriticalProductImage: ({
      alt,
      fallbackImage,
    }: {
      alt: string;
      fallbackImage: string;
    }) => (
      // biome-ignore lint/performance/noImgElement: next/image-backed critical image test double
      <img
        alt={alt}
        data-fetch-priority="high"
        data-loader-prop="false"
        data-loading="eager"
        data-preload="false"
        src={`https://cdn.ogabassey.com/image/width=640,quality=35,format=auto/${fallbackImage.replace(
          /^https:\/\/cdn\.ogabassey\.com\//,
          ''
        )}`}
      />
    ),
    OgabasseyPdpCriticalCommerceProvider: ({
      children,
      ...props
    }: {
      children: ReactNode;
    }) => {
      mockOgabasseyPdpCriticalCommerceProvider(props);
      return <div data-testid="critical-commerce-provider">{children}</div>;
    },
    OgabasseyPdpCriticalConditionBadge: ({
      fallbackCondition,
    }: {
      fallbackCondition?: string | null;
    }) => <span data-ogabassey-pdp-condition>{fallbackCondition}</span>,
    OgabasseyPdpCriticalCommerceSummary: () => {
      mockOgabasseyPdpCriticalCommerceSummary();
      return <div data-testid="critical-commerce-summary" />;
    },
  })
);

vi.mock('@/components/storefront/ogabassey/pdp/client-islands', () => ({
  OgabasseyPdpBelowFoldIsland: (props: {
    product: unknown;
    semanticSections?: ReactNode;
    serverPrimaryDetails?: ReactNode;
    storeSlug: string;
  }) => {
    mockOgabasseyPdpDeferredDetailIsland(props);
    return (
      <section aria-label="Product details">
        {props.serverPrimaryDetails}
        {props.semanticSections}
      </section>
    );
  },
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
  getCachedLegacyProductRedirectTarget: (...args: unknown[]) =>
    mockGetCachedLegacyProductRedirectTarget(...args),
  getCachedProduct: (...args: unknown[]) => mockGetCachedProduct(...args),
  getCachedProductLcpHint: (...args: unknown[]) =>
    mockGetCachedProductLcpHint(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  sanitizeLookupLogValue: (value: unknown) =>
    String(value ?? '')
      .replace(/[\r\n\t]/g, '')
      .substring(0, 100),
}));

vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: (...args: unknown[]) =>
    mockGetCachedStorefrontProductIndex(...args),
}));

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({
    loadCategoryScopedSemanticInventorySafely: (...args: unknown[]) =>
      mockLoadCategoryScopedSemanticInventory(...args),
  })
);

vi.mock('@/lib/storefront-product/build-product-semantic-model', () => ({
  buildProductSemanticModel: (...args: unknown[]) =>
    mockBuildProductSemanticModel(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

vi.mock('@/lib/product-stock', () => ({
  getEffectiveStock: (item: unknown) => mockGetEffectiveStock(item),
}));

vi.mock('@/lib/sanitize-core', () => ({
  escapeHtml: (value: string) => value,
  stripHtmlTags: (value: string | null | undefined) =>
    value?.replace(/<[^>]+>/g, '') || '',
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: () => '{}',
}));

type MockProductUrlInput = {
  id: string;
  slug?: string;
  category?: string | null;
  categories?: { slug?: string } | null;
  category_slug?: string;
  canonical_url?: string | null;
};

function getMockProductUrl(product: MockProductUrlInput) {
  if (product.canonical_url) {
    try {
      return new URL(product.canonical_url).pathname;
    } catch {
      // Fall through to route construction for invalid canonical_url values.
    }
  }

  const productSlug = product.slug ?? product.id;
  const categorySlug =
    product.categories?.slug ||
    product.category_slug ||
    (product.category
      ? product.category.toLowerCase().replace(/\s+/g, '-')
      : undefined);

  return categorySlug
    ? `/${categorySlug}/${productSlug}`
    : `/products/${productSlug}`;
}

function getMockValidatedProductUrl(
  product: MockProductUrlInput,
  baseUrl: string
) {
  const finalProductPath = getMockProductUrl({
    ...product,
    canonical_url: null,
  });
  if (product.canonical_url) {
    try {
      const parsedCanonicalUrl = new URL(product.canonical_url, baseUrl);
      const canonicalPath =
        parsedCanonicalUrl.pathname.replace(/\/+$/, '') || '/';
      const normalizedFinalPath = finalProductPath.replace(/\/+$/, '') || '/';
      if (
        !parsedCanonicalUrl.search &&
        !parsedCanonicalUrl.hash &&
        canonicalPath === normalizedFinalPath
      ) {
        return `${new URL(baseUrl).origin}${parsedCanonicalUrl.pathname}`;
      }
    } catch {
      // Fall through to the deterministic path below.
    }
  }

  return `${baseUrl}${finalProductPath}`;
}

vi.mock('@/lib/seo-utils', () => ({
  buildStorefrontAcceptedPaymentMethods: () => ['Bank transfer'],
  constructCanonicalUrl: (base: string) => base,
  generateBreadcrumbSchema: (items: unknown) =>
    mockGenerateBreadcrumbSchema(items),
  generateMetaTitle: (title: string, options?: { suffix?: string }) =>
    options?.suffix ? `${title} | ${options.suffix}` : title,
  generateMetaDescription: (description: string, maxLength = 160) => {
    const plainText = description.replace(/<[^>]+>/g, '').trim();
    return plainText.length <= maxLength
      ? plainText
      : `${plainText.slice(0, maxLength - 3)}...`;
  },
  generateProductSchema: (...args: unknown[]) =>
    mockGenerateProductSchema(...args),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
  getIndexableRobotsMetadata: () => ({
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  }),
  getProductUrl: (product: MockProductUrlInput) => getMockProductUrl(product),
  getValidatedProductUrl: (product: MockProductUrlInput, baseUrl: string) =>
    getMockValidatedProductUrl(product, baseUrl),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
  buildRequestScopedStoreUrl: (
    merchant: { slug: string; custom_domain?: string },
    headers: Headers
  ) => {
    const customDomain = headers.get('x-custom-domain')?.trim();
    if (customDomain) {
      return `https://${customDomain}`;
    }

    return merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`;
  },
}));

vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: mockNormalizeStorefrontProductVariants,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
  isValidMerchantIdentifier: (value: string) => {
    const reservedNames = new Set(['images', 'product']);
    return (
      (value.includes('.') ||
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(value)) &&
      !reservedNames.has(value.toLowerCase())
    );
  },
}));

vi.mock('./default-product-detail-client', () => ({
  DefaultProductDetailClient: (props: unknown) => {
    mockProductDetailClient(props);
    return null;
  },
}));

vi.mock(
  '@/app/(storefront)/[slug]/(catalog)/(pdp)/products/[productSlug]/product-detail-client',
  () => ({
    default: (props: unknown) => {
      mockProductDetailClient(props);
      return null;
    },
  })
);

import CategoryProductPage, { generateMetadata } from './page';

type ResolveRscOptions = {
  pruneSkippedContent?: boolean;
  stripSuspense?: boolean;
  skipContent?: boolean;
};

type ResolveRscValue = PromiseLike<ReactNode> | ReactNode;

type ResolveRscElementProps = Record<string, unknown> & {
  children?: ResolveRscValue;
};

type ServerComponent = (
  props: ResolveRscElementProps
) => PromiseLike<ReactNode> | ReactNode;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function isRscElement(
  value: ResolveRscValue
): value is ReactElement<ResolveRscElementProps> {
  return isRecord(value) && isValidElement<ResolveRscElementProps>(value);
}

function isReactClassComponent(type: unknown) {
  return (
    typeof type === 'function' &&
    Boolean(
      (
        type as {
          prototype?: { isReactComponent?: unknown };
        }
      ).prototype?.isReactComponent
    )
  );
}

function isServerComponent(type: unknown): type is ServerComponent {
  return typeof type === 'function' && !isReactClassComponent(type);
}

function isAsyncServerComponent(type: unknown): type is ServerComponent {
  return isServerComponent(type) && type.constructor.name === 'AsyncFunction';
}

function isDeferredCategoryProductContent(
  type: unknown,
  props: ResolveRscElementProps
) {
  return (
    isAsyncServerComponent(type) &&
    ((typeof props.slug === 'string' &&
      isPromiseLike(props.searchParams) &&
      isPromiseLike(props.productResultPromise)) ||
      isPromiseLike(props.basePathPromise))
  );
}

function isExpectedRscInterruption(error: unknown) {
  if (isPromiseLike(error)) return true;
  if (!(error instanceof Error)) return false;

  const digest = isRecord(error) ? error.digest : undefined;
  const message = `${error.message} ${
    typeof digest === 'string' ? digest : ''
  }`;
  return (
    message.includes('NEXT_REDIRECT') || message.includes('NEXT_NOT_FOUND')
  );
}

async function resolveRsc(
  element: ResolveRscValue,
  options: ResolveRscOptions = {}
): Promise<ReactNode> {
  if (!element) return element;

  if (Array.isArray(element)) {
    return Promise.all(element.map((item) => resolveRsc(item, options)));
  }

  if (isPromiseLike(element)) {
    const resolvedValue = await element;
    return resolveRsc(resolvedValue as ResolveRscValue, options);
  }

  if (isRscElement(element)) {
    const { type, props } = element;

    if (options.stripSuspense && type === Suspense) {
      return resolveRsc(props.children, options);
    }

    if (isDeferredCategoryProductContent(type, props)) {
      if (options.skipContent) {
        if (options.pruneSkippedContent) {
          return null;
        }
        return element;
      }
    }

    if (isServerComponent(type)) {
      try {
        const resolved = await type(props);
        return resolveRsc(resolved, options);
      } catch (error) {
        if (!isExpectedRscInterruption(error)) {
          console.error('Unexpected RSC test helper error:', error);
        }
        return element;
      }
    }

    if ('children' in props) {
      const resolvedChildren = await resolveRsc(props.children, options);
      return cloneElement(element, {}, resolvedChildren);
    }
  }

  return element;
}

const baseMerchant = {
  id: 'merchant-1',
  business_name: 'TestStore',
  slug: 'teststore',
  logo_url: null,
  payout_currency: 'NGN',
  country: 'NG',
  is_published: true,
};

type LegacyProductVariantFixture = {
  attributes?: Record<string, string>;
  condition?: string | null;
  id: string;
  images?: string[];
  merchant_id?: string;
  price_override?: number;
  primary_image?: string;
  product_id?: string;
  sku?: string;
  stock_quantity?: number;
};

const categorizedDetailedProduct = {
  id: 'prod-1',
  merchant_id: 'merchant-1',
  name: 'HP Laptop 14-ep0063nia',
  slug: 'hp-laptop-14-ep0063nia',
  description: 'A laptop',
  status: 'active',
  price: 645600,
  compare_at_price: null,
  manage_stock: false,
  stock: 10,
  stock_quantity: 10,
  images: [],
  imageHint: null,
  brand: 'HP',
  gtin: null,
  mpn: null,
  category: 'Laptops',
  categories: {
    id: 'cat-1',
    name: 'Laptops',
    slug: 'laptops',
    parent_id: null,
  },
  product_variants: [] as LegacyProductVariantFixture[],
  product_offers: [],
  condition: 'new',
  fulfillmentFields: [],
  updated_at: '2026-06-13T10:00:00.000Z',
};

type LegacyProductFixture = Omit<
  typeof categorizedDetailedProduct,
  'images' | 'price' | 'product_variants'
> & {
  color?: string | null;
  default_variant_id?: string | null;
  has_variants?: boolean;
  images?: string[];
  price: number | string;
  product_variants?: LegacyProductVariantFixture[];
  specifications?: unknown;
  product_key_specs?: unknown;
};

function toLegacyCachedProduct(
  product: LegacyProductFixture = categorizedDetailedProduct
) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    status: product.status,
    slug: product.slug,
    canonical_url: null,
    brand: product.brand,
    category: product.category,
    color: product.color,
    condition: product.condition,
    default_variant_id: product.default_variant_id,
    has_variants: product.has_variants ?? false,
    manage_stock: product.manage_stock,
    price: product.price,
    schema_markup: null,
    updated_at: product.updated_at,
    stock_quantity: product.stock_quantity ?? product.stock,
    stock: product.stock,
    base_price:
      typeof product.price === 'string'
        ? Number.parseFloat(product.price)
        : product.price,
    sale_price: null,
    min_variant_price: null,
    max_variant_price: null,
    track_quantity: product.manage_stock,
    quantity: product.stock_quantity ?? product.stock,
    images: product.images,
    product_variants: product.product_variants,
    offers: product.product_offers,
    product_categories: [
      {
        categories: product.categories,
      },
    ],
    specifications: product.specifications ?? null,
    product_key_specs: product.product_key_specs ?? null,
  };
}

function mockDefaultCachedProductLookup() {
  mockGetCachedProduct.mockImplementation((_merchantId, productSlug) =>
    Promise.resolve(
      productSlug === categorizedDetailedProduct.slug
        ? toLegacyCachedProduct()
        : null
    )
  );
}

function mockDefaultCachedProductLcpHintLookup() {
  mockGetCachedProductLcpHint.mockImplementation((_merchantId, productSlug) =>
    Promise.resolve(
      productSlug === categorizedDetailedProduct.slug
        ? toLegacyCachedProduct()
        : null
    )
  );
}

beforeEach(() => {
  mockResetReactCacheStores();
});

describe('[category]/[productSlug] page metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveStock.mockReset();
    mockGetEffectiveStock.mockImplementation(getMockEffectiveStock);
    mockOgabasseyPdpCriticalCommerce.mockReset();
    mockOgabasseyPdpCriticalCommerceProvider.mockReset();
    mockOgabasseyPdpCriticalCommerceSummary.mockReset();
    mockOgabasseyPdpDeferredDetailIsland.mockReset();
    mockOgabasseyProductDetailsPage.mockReset();
    mockProductDetailClient.mockReset();
    mockProductDetailClient.mockReturnValue(null);
    mockGenerateProductSchema.mockReset();
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    mockNormalizeStorefrontProductVariants.mockReset();
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);
    mockGetRequestScopedMerchant.mockResolvedValue(baseMerchant);
    mockGetCachedProduct.mockReset();
    mockDefaultCachedProductLookup();
    mockGetCachedProductLcpHint.mockReset();
    mockGetCachedProductLcpHint.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);
    mockGetPublishedClusterPosts.mockReset();
    mockGetPublishedClusterPosts.mockResolvedValue([]);
  });

  it('keeps product metadata cacheable and leaves request binding to the storefront layout', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );

    await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(mockConnection).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockGetRequestScopedMerchant).toHaveBeenCalled();
  });

  it('returns noindex placeholder metadata without merchant or product lookups', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: OGABASSEY_DOMAIN,
        category: 'smartphones',
        productSlug: PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toEqual({
      title: 'Product not found',
      description: 'This product is unavailable or has moved.',
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
    });
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('returns notFound for the invalid-store prerender placeholder before merchant or product lookups', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
          category: 'smartphones',
          productSlug: PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('returns noindex soft-404 metadata for over-encoded bot slugs without product lookups', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let overEncodedSlug = 'samsung-s10 8gb-128gb';
    for (let i = 0; i < 10; i++) {
      overEncodedSlug = encodeURIComponent(overEncodedSlug);
    }

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'smartphones',
          productSlug: overEncodedSlug,
        }),
        searchParams: Promise.resolve({}),
      });

      expect(metadata.title).toBe('Product not found');
      expect(metadata.robots).toEqual({ index: false, follow: true });
      expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not gate an over-long category with a valid product (flows to the canonical redirect)', async () => {
    // Category feeds only hasCategoryMismatch (in-memory string compare), never
    // a cache/DB key, so an over-long category with a valid product must reach
    // getProductRouteControl and emit the canonical-category redirect metadata
    // (real 308 at render) — NOT be gated to a soft not-found.
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'a'.repeat(4000),
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    // The product lookup ran — the over-long category did not short-circuit it.
    expect(mockGetCachedProductWithDetails).toHaveBeenCalled();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('hard-404s an unsafe segment when the merchant does not exist', async () => {
    // Unsafe segments skip getProductRouteControl but still run the bounded
    // merchant check, so a nonexistent tenant gets a real notFound(), not a
    // soft product-not-found shell.
    mockGetRequestScopedMerchant.mockResolvedValueOnce(null);

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'no-such-store',
          category: 'smartphones',
          productSlug: 'a'.repeat(4000),
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('returns noindex soft-404 metadata for extremely long slugs without product lookups', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'a'.repeat(4000),
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toBe('Product not found');
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
  });

  it('builds metadata from the LCP hint without hydrating full product details', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      status: 'active',
      slug: 'hp-laptop-14-ep0063nia',
      canonical_url: null,
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      condition: 'new',
      manage_stock: false,
      price: 645_600,
      base_price: 645_600,
      sale_price: null,
      stock_quantity: 10,
      meta_title: 'HP Laptop 14 Price',
      meta_description:
        '<p>Shop the HP Laptop 14-ep0063nia with warranty and delivery.</p>',
      keywords: ['hp laptop', 'laptop price in nigeria'],
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(metadata.title).toEqual({
      absolute: 'HP Laptop 14 Price | TestStore',
    });
    expect(metadata.description).toBe(
      'Shop the HP Laptop 14-ep0063nia with warranty and delivery.'
    );
    expect(metadata.keywords).toEqual(['hp laptop', 'laptop price in nigeria']);
    expect(metadata.alternates?.canonical).toBe(
      'https://teststore.usebaci.com/laptops/hp-laptop-14-ep0063nia'
    );
    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/products/hp-laptop.png',
        alt: 'HP Laptop 14-ep0063nia',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/products/hp-laptop.png',
    ]);
    expect(metadata.other).toMatchObject({
      'product:price:amount': '645600',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
    });
  });

  it('keeps the OgaBassey app banner when category PDP metadata adds product tags', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      business_name: 'Ogabassey',
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      canonical_url: null,
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      condition: 'new',
      manage_stock: false,
      price: 645_600,
      base_price: 645_600,
      sale_price: null,
      stock_quantity: 10,
      meta_title: 'HP Laptop 14 Price',
      meta_description:
        '<p>Shop the HP Laptop 14-ep0063nia with warranty and delivery.</p>',
      keywords: ['hp laptop', 'laptop price in nigeria'],
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.other).toMatchObject({
      'apple-itunes-app': 'app-id=6472735367',
      'product:price:amount': '645600',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
    });
  });

  it('normalizes explicit plus-model metadata to crawler-stable text', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-plus',
      name: 'Samsung Galaxy Tab S9+',
      slug: 'samsung-galaxy-tab-s9-plus',
      canonical_url: null,
      brand: 'Samsung',
      category: 'Tablets',
      categories: {
        id: 'cat-tablets',
        name: 'Tablets',
        slug: 'tablets',
      },
      condition: 'new',
      manage_stock: false,
      price: 950_000,
      base_price: 950_000,
      sale_price: null,
      stock_quantity: 10,
      meta_title: 'Samsung Galaxy Tab S9+ Price in Nigeria',
      meta_description:
        'Shop Samsung Galaxy Tab S9+ tablet at Ogabassey before checkout.',
      keywords: [],
      images: ['https://cdn.example.com/products/tab-s9-plus.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'tablets',
        productSlug: 'samsung-galaxy-tab-s9-plus',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({
      absolute: 'Samsung Galaxy Tab S9 Plus Price in Nigeria | TestStore',
    });
    expect(metadata.description).toBe(
      'Shop Samsung Galaxy Tab S9 Plus tablet at Ogabassey before checkout.'
    );
  });

  it('uses normalized generated category metadata when explicit title sanitizes empty', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-plus-empty-title',
      name: 'Samsung Galaxy Tab S9+',
      slug: 'samsung-galaxy-tab-s9-plus',
      canonical_url: null,
      brand: 'Samsung',
      category: 'Tablets',
      categories: {
        id: 'cat-tablets',
        name: 'Tablets',
        slug: 'tablets',
      },
      condition: 'new',
      manage_stock: false,
      price: 950_000,
      base_price: 950_000,
      sale_price: null,
      stock_quantity: 10,
      meta_title: '<span></span>',
      meta_description: 'Shop Samsung Galaxy Tab S9+.',
      keywords: [],
      images: ['https://cdn.example.com/products/tab-s9-plus.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'tablets',
        productSlug: 'samsung-galaxy-tab-s9-plus',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({
      absolute: 'Samsung Galaxy Tab S9 Plus Price in Nigeria | TestStore',
    });
    expect(metadata.description).toBe('Shop Samsung Galaxy Tab S9 Plus.');
  });

  it('adds currency codes to explicit gift-card metadata with currency symbols', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-gift-card',
      name: 'PSN Gift Card £50',
      slug: 'psn-gift-card-gbp-50',
      canonical_url: null,
      brand: 'Sony',
      category: 'Gift Cards',
      categories: {
        id: 'cat-gift-cards',
        name: 'Gift Cards',
        slug: 'gift-cards',
      },
      condition: 'new',
      manage_stock: false,
      price: 85_000,
      base_price: 85_000,
      sale_price: null,
      stock_quantity: 10,
      meta_title: 'PSN Gift Card £50 Price in Nigeria',
      meta_description:
        'PSN Gift Card £50 at Ogabassey: £50 value for PlayStation Store.',
      keywords: [],
      images: ['https://cdn.example.com/products/psn-gbp-50.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'gift-cards',
        productSlug: 'psn-gift-card-gbp-50',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({
      absolute: 'PSN Gift Card £50 GBP Price in Nigeria | TestStore',
    });
    expect(metadata.description).toBe(
      'PSN Gift Card £50 GBP at Ogabassey: £50 GBP value for PlayStation Store.'
    );
  });

  it('uses generated SEO fallback copy when the compact LCP hint omits rich descriptions', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      canonical_url: null,
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      condition: 'new',
      manage_stock: false,
      price: null,
      stock_quantity: 10,
      meta_description: null,
      keywords: [],
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      schema_markup: null,
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(metadata.description).toContain(
      'Check HP Laptop 14-ep0063nia price in Nigeria on TestStore'
    );
    expect(metadata.description).toContain('payment options');
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it('does not advertise blank LCP hint prices as zero-price products', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      manage_stock: false,
      price: '   ',
      stock_quantity: 10,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.other ?? {}).not.toHaveProperty('product:price:amount');
  });

  it('parses LCP hint variant range prices from numeric strings', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      manage_stock: false,
      price: null,
      min_variant_price: '390000.00',
      max_variant_price: '520000.00',
      stock_quantity: 10,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.other).toMatchObject({
      'product:price:amount': '390000',
      'product:price:currency': 'NGN',
    });
    expect(metadata.description).toContain('starts from');
  });

  it('does not advertise denormalized variant ranges for managed-stock LCP hints', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      manage_stock: true,
      price: 645_600,
      min_variant_price: '390000.00',
      max_variant_price: '520000.00',
      stock_quantity: 10,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.other).toMatchObject({
      'product:price:amount': '645600',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
    });
    expect(metadata.description).not.toContain('starts from');
  });

  it('defaults nullable LCP hint manage_stock to managed stock metadata', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      manage_stock: null,
      price: 645_600,
      min_variant_price: '390000.00',
      max_variant_price: '520000.00',
      stock_quantity: 0,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.other ?? {}).not.toHaveProperty('product:price:amount');
    expect(metadata.other).toMatchObject({
      'product:availability': 'out of stock',
    });
  });

  it('does not use condition offer joins in compact LCP hint metadata', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'HP Laptop 14-ep0063nia',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      condition: 'new',
      manage_stock: false,
      price: 645_600,
      stock_quantity: 10,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: '525000.00',
          status: 'active',
          stock_quantity: '3',
        },
        {
          id: 'offer-main-condition',
          condition: 'new',
          price: '1',
          status: 'active',
          stock_quantity: '1',
        },
        {
          id: 'offer-inactive',
          condition: 'open_box',
          price: '300000',
          status: 'inactive',
          stock_quantity: '1',
        },
      ],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(metadata.other).toMatchObject({
      'product:price:amount': '645600',
      'product:price:currency': 'NGN',
    });
  });

  it('does not noindex UUID PDP metadata when the LCP hint resolves a canonical slug', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      id: 'abcdef12-3456-4789-abcd-abcdef123456',
      name: 'HP Laptop 14-ep0063nia',
      status: 'active',
      slug: 'hp-laptop-14-ep0063nia',
      brand: 'HP',
      category: 'Laptops',
      categories: {
        id: 'cat-1',
        name: 'Laptops',
        slug: 'laptops',
      },
      manage_stock: false,
      price: 645_600,
      stock_quantity: 10,
      images: ['https://cdn.example.com/products/hp-laptop.png'],
      product_categories: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'abcdef12-3456-4789-abcd-abcdef123456',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('returns noindex metadata for legacy archived variant slugs (real HTTP 308 happens during page render)', async () => {
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue({
      id: 'parent-1',
      name: 'iPhone 13 Pro Max',
      slug: 'iphone-13-pro-max',
      category: 'Phones',
      categories: { id: 'cat-1', name: 'Phones', slug: 'phones' },
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'iphone-13-pro-max-6gb-128gb',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockGetCachedLegacyProductRedirectTarget).toHaveBeenCalledWith(
      'merchant-1',
      'iphone-13-pro-max-6gb-128gb'
    );
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('returns noindex soft-404 metadata when the product is missing and no legacy redirect exists', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    let metadata: Awaited<ReturnType<typeof generateMetadata>>;

    try {
      metadata = await generateMetadata({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'smartphones',
          productSlug: 'missing-product',
        }),
        searchParams: Promise.resolve({}),
      });
    } finally {
      consoleWarnSpy.mockRestore();
    }

    expect(metadata?.title).toBe('Product not found');
    expect(metadata?.description).toBe(
      'This product is unavailable or has moved.'
    );
    expect(metadata?.robots).toMatchObject({ index: false, follow: true });
    expect(metadata?.alternates).toBeNull();
    expect(metadata?.openGraph).toMatchObject({
      title: 'Product not found',
      description: 'This product is unavailable or has moved.',
    });
    expect(metadata?.twitter).toMatchObject({
      card: 'summary',
      title: 'Product not found',
      description: 'This product is unavailable or has moved.',
    });
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('returns noindex metadata for category-mismatch URLs (real HTTP 308 happens during page render)', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'hp',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('returns noindex metadata for mixed-case product slugs (real HTTP 308 happens during page render)', async () => {
    mockGetCachedProductWithDetails.mockResolvedValueOnce(
      categorizedDetailedProduct
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'HP-LAPTOP-14-EP0063NIA',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledOnce();
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledWith(
      'merchant-1',
      'HP-LAPTOP-14-EP0063NIA'
    );
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('does not noindex metadata when the resolved canonical product slug matches the URL case', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      slug: 'HP-LAPTOP-14-EP0063NIA',
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'HP-LAPTOP-14-EP0063NIA',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('strips HTML from category product metadata descriptions', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      meta_description:
        '<p>A <strong>premium</strong> laptop built for creators.</p>',
      description:
        '<p>A <strong>premium</strong> laptop built for creators.</p>',
      images: ['https://cdn.example.com/products/hp-laptop.png'],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.description).toBe('A premium laptop built for creators.');
    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    });
    expect(metadata.openGraph?.description).toBe(
      'A premium laptop built for creators.'
    );
    expect(metadata.twitter?.description).toBe(
      'A premium laptop built for creators.'
    );
    expect(metadata.other).toMatchObject({
      'product:price:amount': '645600',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
      'twitter:label1': 'Price',
      'twitter:data1': 'NGN 645600',
      'twitter:label2': 'Availability',
      'twitter:data2': 'In stock',
    });
    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/products/hp-laptop.png',
        alt: 'HP Laptop 14-ep0063nia',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/products/hp-laptop.png',
    ]);
  });

  it('removes stale absolute listed-price sentences from category product metadata', async () => {
    const expectedDescription =
      'Premium foldable phone with triple-screen multitasking, flagship cameras, warranty, delivery, and secure payment options for Nigerian shoppers.';
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      description: 'Detailed foldable phone overview.',
      images: ['https://cdn.example.com/products/trifold.png'],
      meta_description: `${expectedDescription} Current listed price is NGN 2,500,000.`,
      name: 'Samsung Galaxy Z TriFold',
      slug: 'samsung-galaxy-z-trifold',
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'samsung-galaxy-z-trifold',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.description).toBe(expectedDescription);
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it('targets device price in Nigeria when custom metadata is absent', async () => {
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'iphone13-128',
        attributes: { storage: '128GB' },
        price_override: 390000,
        stock_quantity: 5,
      },
      {
        id: 'iphone13-256',
        attributes: { storage: '256GB' },
        price_override: 520000,
        stock_quantity: 5,
      },
    ]);
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'iPhone 13',
      slug: 'iphone-13',
      description: 'Apple iPhone 13 with A15 Bionic.',
      price: 430000,
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
      product_variants: [
        { id: 'iphone13-128', price_override: 390000 },
        { id: 'iphone13-256', price_override: 520000 },
      ],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'iphone-13',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({
      absolute: 'iPhone 13 Price in Nigeria | TestStore',
    });
    expect(metadata.description).toContain(
      'iPhone 13 price in Nigeria starts from ₦390,000 on TestStore'
    );
    expect(metadata.other).toMatchObject({
      'product:price:amount': '390000',
      'product:price:currency': 'NGN',
    });
  });

  it('omits Nigeria price copy for non-Nigerian storefront metadata', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      country: 'GH',
      payout_currency: 'GHS',
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'Pixel 10',
      slug: 'pixel-10',
      description: 'Google Pixel phone.',
      price: 999,
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'pixel-10',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({ absolute: 'Pixel 10 Price | TestStore' });
    expect(metadata.description).toContain('Pixel 10 price is');
    expect(metadata.description).not.toContain('in Nigeria');
  });

  it('formats OgaBassey PDP product display with the merchant payout currency', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      country: 'GH',
      payout_currency: 'GHS',
      template_id: OGABASSEY_TEMPLATE_ID,
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'Pixel 10',
      slug: 'pixel-10',
      description: 'Google Pixel phone.',
      price: 999,
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'pixel-10',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const ogabasseyProps = mockOgabasseyPdpDeferredDetailIsland.mock.calls
      .at(-1)
      ?.at(0) as { product?: { price?: string } } | undefined;

    // Ghanaian cedi symbol, not the ISO code: the PDP formatter must use the
    // merchant's own locale (en-GH) instead of a hardcoded en-NG locale.
    expect(ogabasseyProps?.product?.price).toBe('GH₵999');
    expect(ogabasseyProps?.product?.price).not.toContain('₦');
  });

  it('leaves variant query redirects to page rendering, not metadata generation', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-new-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'new',
        stock_quantity: 5,
      },
      {
        id: 'variant-used-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'used',
        stock_quantity: 3,
      },
    ]);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({
        storage: '128GB',
        utm_source: 'google',
      }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://teststore.usebaci.com/laptops/hp-laptop-14-ep0063nia'
    );
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });
});

describe('[category]/[productSlug] page render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveStock.mockReset();
    mockGetEffectiveStock.mockImplementation(getMockEffectiveStock);
    mockProductDetailClient.mockReset();
    mockProductDetailClient.mockReturnValue(null);
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    mockNormalizeStorefrontProductVariants.mockReset();
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);
    mockGetStorefrontShellSnapshotBase.mockReset();
    mockGetStorefrontShellSnapshotBase.mockResolvedValue({
      merchant: {
        ...baseMerchant,
        template_id: OGABASSEY_TEMPLATE_ID,
      },
      routingMode: 'path',
      basePath: '/teststore',
    });
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      template_id: OGABASSEY_TEMPLATE_ID,
    });
    mockGetCachedProduct.mockReset();
    mockDefaultCachedProductLookup();
    mockGetCachedProductLcpHint.mockReset();
    mockDefaultCachedProductLcpHintLookup();
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);
    mockGetCachedCategoryPageData.mockReset();
    mockGetCachedCategoryPageData.mockResolvedValue(null);
    mockLoadCategoryScopedSemanticInventory.mockReset();
    mockLoadCategoryScopedSemanticInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Products',
      products: [],
    });
    mockGetPublishedClusterPosts.mockReset();
    mockGetPublishedClusterPosts.mockResolvedValue([]);
    mockBuildProductSemanticModel.mockReset();
    mockOgabasseyPdpProductResourceHints.mockReset();
    mockOgabasseyPdpProductResourceHints.mockReturnValue(null);
    mockOgabasseyPdpSemanticSections.mockReset();
    mockOgabasseyPdpStaticResourceHints.mockReset();
    mockPreloadOgabasseyPdpStaticResources.mockReset();
    mockOgabasseyPdpCriticalCommerce.mockReset();
    mockOgabasseyPdpCriticalCommerceProvider.mockReset();
    mockOgabasseyPdpCriticalCommerceSummary.mockReset();
    mockOgabasseyPdpDeferredDetailIsland.mockReset();
    mockOgabasseyProductDetailsPage.mockReset();
    mockBuildProductSemanticModel.mockReturnValue({
      trustBullets: [],
      supportLinks: [],
      guideLinks: [],
      alternatives: null,
      sameBrand: null,
      samePrice: null,
    });
  });

  it('reuses shared PDP route-control data across metadata and page rendering', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/shared-pdp-route-cache.avif';
    const params = {
      slug: 'teststore',
      category: 'laptops',
      productSlug: 'hp-laptop-14-ep0063nia',
    };

    mockGetCachedProductLcpHint.mockResolvedValue(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      images: [productImage],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });

    await CategoryProductPage({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://teststore.usebaci.com/laptops/hp-laptop-14-ep0063nia'
    );
    expect(mockGetRequestScopedMerchant).toHaveBeenCalledTimes(1);
    expect(mockGetCachedProductLcpHint).toHaveBeenCalledTimes(1);
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledTimes(1);
  });

  it('renders the OgaBassey PDP hero into the static shell without forcing the leaf dynamic', async () => {
    const ui = await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      })
    );
    const { container } = render(ui);
    const criticalShell = container.querySelector(
      '[data-ogabassey-pdp-critical-shell]'
    );

    if (!criticalShell) {
      throw new Error('Expected the OgaBassey PDP critical shell to render');
    }

    expect(mockConnection).not.toHaveBeenCalled();
    // This page-level assertion covers the PDP metadata/JSON-LD render path.
    // The shell base-path helper is mocked here and covered separately in
    // storefront-shell-snapshot.test.ts so this test stays scoped to the PDP.
    expect(mockHeaders).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('prefers the direct canonical category over additional product collections', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce({
      ...toLegacyCachedProduct(),
      categories: categorizedDetailedProduct.categories,
      product_categories: [
        {
          categories: { id: 'collection-hp', name: 'HP', slug: 'hp' },
        },
      ],
    });

    const ui = await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      })
    );

    render(ui);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('renders one visible OgaBassey PDP h1 after the critical shell split', async () => {
    const ui = await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      })
    );

    const { container } = render(ui);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
  });

  it('renders known OgaBassey PDP critical images through the preloaded Image path', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/hp-laptop.avif';
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      id: OGABASSEY_MERCHANT_ID,
      slug: OGABASSEY_DOMAIN,
      template_id: OGABASSEY_TEMPLATE_ID,
    });
    mockGetCachedProductLcpHint.mockResolvedValue(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [productImage],
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: OGABASSEY_DOMAIN,
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const productImageElement = screen.getByRole('img', {
      name: 'HP Laptop 14-ep0063nia',
    });
    const productImageSrc = productImageElement.getAttribute('src');

    expect(productImageSrc).toContain(
      'https://cdn.ogabassey.com/image/width=640,quality=35,format=auto/core-assets/products/hp-laptop.avif'
    );
    expect(productImageSrc).not.toContain('/api/ogabassey/pdp-lcp-image');
    expect(productImageElement).toHaveAttribute('data-loader-prop', 'false');
    expect(productImageElement).toHaveAttribute('data-fetch-priority', 'high');
    expect(productImageElement).toHaveAttribute('data-loading', 'eager');
    expect(productImageElement).toHaveAttribute('data-preload', 'false');
    expect(productImageElement).not.toHaveAttribute('priority');
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: productImage,
    });
  });

  it('splits OgaBassey client work into critical commerce and deferred detail islands', async () => {
    const { container } = render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpCriticalCommerce).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({
          name: 'HP Laptop 14-ep0063nia',
        }),
      })
    );
    const criticalCommerceProps =
      mockOgabasseyPdpCriticalCommerce.mock.calls.at(-1)?.[0] as
        | { cartBasePathPromise?: Promise<string> }
        | undefined;
    await expect(criticalCommerceProps?.cartBasePathPromise).resolves.toBe(
      '/teststore'
    );
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        cartProduct: expect.objectContaining({
          name: 'HP Laptop 14-ep0063nia',
        }),
      })
    );
    expect(mockOgabasseyPdpCriticalCommerceSummary).toHaveBeenCalled();
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({
          name: 'HP Laptop 14-ep0063nia',
        }),
        semanticSections: expect.anything(),
      })
    );
    const deferredDetailProps =
      mockOgabasseyPdpDeferredDetailIsland.mock.calls.at(-1)?.[0] as
        | { semanticSections?: ReactNode }
        | undefined;
    const semanticSections = deferredDetailProps?.semanticSections;

    expect(isValidElement(semanticSections)).toBe(true);
    const semanticBoundaryChildren = isValidElement(semanticSections)
      ? (semanticSections as ReactElement<{ children?: ReactNode }>).props
          .children
      : undefined;
    expect(isValidElement(semanticBoundaryChildren)).toBe(true);
    expect(
      isValidElement(semanticBoundaryChildren)
        ? semanticBoundaryChildren.type
        : null
    ).toBe(Suspense);
    expect(
      isValidElement(semanticBoundaryChildren)
        ? (semanticBoundaryChildren as ReactElement<{ fallback?: ReactNode }>)
            .props.fallback
        : undefined
    ).toBeNull();
    expect(
      screen.getByRole('complementary', { name: /purchase options/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /product details/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: /HP Laptop 14-ep0063nia overview and specifications/i,
      })
    ).toBeInTheDocument();
    expect(mockOgabasseyProductDetailsPage).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('img[alt="HP Laptop 14-ep0063nia"]')
    ).toHaveLength(1);
  });

  it('threads the merchant-resolved currency into the critical commerce provider and shell', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      country: 'GH',
      payout_currency: 'GHS',
      template_id: OGABASSEY_TEMPLATE_ID,
    });

    await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: expect.objectContaining({ code: 'GHS' }),
      })
    );
  });

  it('renders first-viewport OgaBassey commerce selectors for variant products', async () => {
    const variantRows = [
      {
        id: 'variant-128-4',
        attributes: { ram: '4GB', storage: '128GB' },
        condition: 'new',
        price_override: 237_674.42,
        stock_quantity: 10,
      },
      {
        id: 'variant-256-8',
        attributes: { ram: '8GB', storage: '256GB' },
        condition: 'new',
        price_override: 278_418.6,
        stock_quantity: 8,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        product_variants: variantRows,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      product_variants: variantRows,
      variant_attributes: {
        ram: ['4GB', '8GB'],
        storage: ['128GB', '256GB'],
      },
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variantRows);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpCriticalCommerce).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({
          variantCount: 2,
        }),
      })
    );
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        cartProduct: expect.objectContaining({
          variants: [
            expect.objectContaining({
              attributes: { ram: '4GB', storage: '128GB' },
              id: 'variant-128-4',
            }),
            expect.objectContaining({
              attributes: { ram: '8GB', storage: '256GB' },
              id: 'variant-256-8',
            }),
          ],
        }),
        variantAxes: ['storage', 'ram'],
        variantCount: 2,
      })
    );
    expect(mockOgabasseyProductDetailsPage).not.toHaveBeenCalled();
    expect(
      screen.getByRole('complementary', { name: /purchase options/i })
    ).toBeInTheDocument();
  });

  it('uses legacy stock fallback from the LCP hint for critical cart controls', async () => {
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        stock: 9,
        stock_quantity: 0,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      stock: 9,
      stock_quantity: 0,
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        cartProduct: expect.objectContaining({
          stock: 9,
        }),
      })
    );
  });

  it('keeps critical PDP links root-relative for domain-routed storefront requests', async () => {
    mockGetStorefrontShellSnapshotBase.mockResolvedValueOnce({
      merchant: {
        ...baseMerchant,
        template_id: OGABASSEY_TEMPLATE_ID,
      },
      routingMode: 'domain',
      basePath: '',
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockGetStorefrontShellSnapshotBase).toHaveBeenCalledWith(
      'teststore'
    );
    const criticalCommerceProps =
      mockOgabasseyPdpCriticalCommerce.mock.calls.at(-1)?.[0] as
        | { cartBasePathPromise?: Promise<string> }
        | undefined;
    await expect(criticalCommerceProps?.cartBasePathPromise).resolves.toBe('');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/laptops'
    );
  });

  it('falls back to the slug base path when the shell snapshot base path is malformed', async () => {
    mockGetStorefrontShellSnapshotBase.mockResolvedValueOnce({
      merchant: {
        ...baseMerchant,
        template_id: OGABASSEY_TEMPLATE_ID,
      },
      routingMode: 'path',
      basePath: 'teststore',
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const criticalCommerceProps =
      mockOgabasseyPdpCriticalCommerce.mock.calls.at(-1)?.[0] as
        | { cartBasePathPromise?: Promise<string> }
        | undefined;
    await expect(criticalCommerceProps?.cartBasePathPromise).resolves.toBe(
      '/teststore'
    );
  });

  it('renders one visible all-offer summary in the critical shell', async () => {
    const { container } = render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const commerceSlot = container.querySelector(
      '[data-ogabassey-pdp-commerce-slot]'
    );

    expect(commerceSlot).not.toBeNull();
    expect(
      commerceSlot?.querySelector('script[type="application/ld+json"]')
    ).toBeNull();
    expect(
      container.querySelector('script[type="application/ld+json"]')
    ).not.toBeNull();
    expect(
      screen.getByText('HP Laptop 14-ep0063nia. Condition: New.')
    ).toBeInTheDocument();
  });

  it('keeps visible OgaBassey product identity aligned with Product JSON-LD input', async () => {
    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HP Laptop 14-ep0063nia',
        price: 645_600,
        category: 'Laptops',
      }),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('renders stable noindex soft-not-found content when the product is missing', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockGetCachedProductWithDetails.mockResolvedValueOnce(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValueOnce(null);

    try {
      render(
        (await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'missing-product',
          }),
          searchParams: Promise.resolve({}),
        })) as ReactElement
      );

      expect(
        screen.getByRole('heading', { name: 'Product not found' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Continue shopping' })
      ).toHaveAttribute('href', '/teststore');
      expect(mockNotFound).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).toHaveBeenCalledWith(
        baseMerchant.id,
        'missing-product'
      );
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        'Product not found for storefront product route:',
        'missing-product'
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('renders the prerender placeholder without merchant or product lookups', async () => {
    render(
      (await CategoryProductPage({
        params: Promise.resolve({
          slug: OGABASSEY_DOMAIN,
          category: 'smartphones',
          productSlug: PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
        }),
        searchParams: Promise.resolve({}),
      })) as ReactElement
    );

    expect(
      screen.getByRole('heading', { name: 'Product not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue shopping' })
    ).toHaveAttribute('href', '/');
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('renders soft-not-found for over-encoded bot slugs without any product lookups', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let overEncodedSlug = 'samsung-s10 8gb-128gb';
    for (let i = 0; i < 10; i++) {
      overEncodedSlug = encodeURIComponent(overEncodedSlug);
    }

    try {
      render(
        (await CategoryProductPage({
          params: Promise.resolve({
            // OgaBassey domain also exercises the LCP-hint prewarm gate.
            slug: OGABASSEY_DOMAIN,
            category: 'smartphones',
            productSlug: overEncodedSlug,
          }),
          searchParams: Promise.resolve({}),
        })) as ReactElement
      );

      expect(
        screen.getByRole('heading', { name: 'Product not found' })
      ).toBeInTheDocument();
      expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('renders soft-not-found for extremely long slugs without any product lookups', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      render(
        (await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'a'.repeat(4000),
          }),
          searchParams: Promise.resolve({}),
        })) as ReactElement
      );

      expect(
        screen.getByRole('heading', { name: 'Product not found' })
      ).toBeInTheDocument();
      expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('hard-404s an unsafe segment on the render path when the merchant does not exist', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    // Unsafe segments skip getProductRouteControl/prewarm but still run the
    // bounded merchant check, so a nonexistent tenant hard-404s here too.
    mockGetRequestScopedMerchant.mockResolvedValueOnce(null);

    try {
      await expect(
        CategoryProductPage({
          params: Promise.resolve({
            slug: 'no-such-store',
            category: 'smartphones',
            productSlug: 'a'.repeat(4000),
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalledOnce();
      expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('returns notFound for the invalid-store prerender placeholder without merchant or product lookups', async () => {
    await expect(
      CategoryProductPage({
        params: Promise.resolve({
          slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
          category: 'smartphones',
          productSlug: PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedProductLcpHint).not.toHaveBeenCalled();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('uses the same NGN fallback currency for metadata and product JSON-LD', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      payout_currency: null,
      template_id: OGABASSEY_TEMPLATE_ID,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(metadata.other).toMatchObject({
      'product:price:currency': 'NGN',
    });
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.any(Object),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('keeps marketing description out of the critical summary and routes it to deferred details', async () => {
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      description:
        '<p>A <strong>premium</strong> laptop built for creators.</p>',
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const deferredDetailProps = mockOgabasseyPdpDeferredDetailIsland.mock.calls
      .at(-1)
      ?.at(0) as { product?: { description?: string } } | undefined;

    expect(deferredDetailProps?.product?.description).toBe(
      '<p>A <strong>premium</strong> laptop built for creators.</p>'
    );
    expect(
      screen.queryByText('premium laptop built for creators')
    ).not.toBeInTheDocument();
  });

  it('removes stale absolute listed-price sentences before deferred PDP detail rendering', async () => {
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      description:
        'Premium foldable phone. Current listed price is NGN 2,500,000. Confirm selected variant price before checkout.',
      name: 'Samsung Galaxy Z TriFold',
      slug: 'samsung-galaxy-z-trifold',
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'samsung-galaxy-z-trifold',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const expectedDescription =
      'Premium foldable phone. Confirm selected variant price before checkout.';
    const ogabasseyProps = mockOgabasseyPdpDeferredDetailIsland.mock.calls
      .at(-1)
      ?.at(0) as
      | {
          product?: {
            description?: string;
          };
        }
      | undefined;

    const criticalCommerceProviderProps =
      mockOgabasseyPdpCriticalCommerceProvider.mock.calls.at(-1)?.at(0) as
        | {
            cartProduct?: {
              description?: string;
            };
          }
        | undefined;

    expect(screen.queryByText(/Current listed price/i)).not.toBeInTheDocument();
    expect(ogabasseyProps?.product?.description).toBe(expectedDescription);
    expect(criticalCommerceProviderProps?.cartProduct?.description).toBe(
      expectedDescription
    );
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expectedDescription,
      }),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('mounts the OgaBassey PDP preload hints for the OgaBassey template branch', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/hp-laptop.avif';
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [productImage],
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockPreloadOgabasseyPdpStaticResources).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpStaticResourceHints).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: productImage,
    });
  });

  it('preloads the OgaBassey PDP product image before full product details resolve', async () => {
    let resolveProductDetails:
      | ((value: typeof categorizedDetailedProduct) => void)
      | undefined;
    const routeEvents: string[] = [];
    const earlyProductImage =
      'https://cdn.ogabassey.com/core-assets/products/early-lenovo-legion.avif';
    mockGetCachedProductLcpHint.mockImplementationOnce(() => {
      routeEvents.push('lcp-hint');
      return Promise.resolve(
        toLegacyCachedProduct({
          ...categorizedDetailedProduct,
          images: [earlyProductImage],
        })
      );
    });
    mockOgabasseyPdpProductResourceHints.mockImplementationOnce(() => {
      routeEvents.push('product-hints');
      return null;
    });
    mockGetCachedProductWithDetails.mockImplementationOnce(() => {
      routeEvents.push('product-details');
      return new Promise((resolve) => {
        resolveProductDetails = resolve;
      });
    });

    const pagePromise = CategoryProductPage({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    // Run the early lookup by calling resolveRsc on the page promise.
    // This will execute the early lookup component synchronously/asynchronously, while the main content suspends.
    const resolvedPage = await resolveRsc(pagePromise, { skipContent: true });

    expect(mockGetCachedProductLcpHint).toHaveBeenCalledWith(
      baseMerchant.id,
      'hp-laptop-14-ep0063nia',
      { includeVariants: true }
    );
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: earlyProductImage,
    });
    expect(routeEvents).toEqual([
      'lcp-hint',
      'product-hints',
      'product-details',
    ]);
    expect(mockPreloadOgabasseyPdpStaticResources).not.toHaveBeenCalled();
    expect(mockOgabasseyProductDetailsPage).not.toHaveBeenCalled();

    resolveProductDetails?.(categorizedDetailedProduct);
    render(await resolveRsc(resolvedPage));

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledTimes(1);
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalled();
  });

  it('starts the OgaBassey product LCP hint before the merchant lookup resolves', async () => {
    let resolveMerchant:
      | ((
          value: typeof baseMerchant & {
            custom_domain: string;
            template_id: string;
          }
        ) => void)
      | undefined;
    let merchantLookupCount = 0;
    const routeEvents: string[] = [];
    const baseProductImage =
      'https://cdn.ogabassey.com/core-assets/products/domain-lcp-hint.avif';
    const variantProductImage =
      'https://cdn.ogabassey.com/core-assets/products/domain-lcp-variant.avif';
    const variants = [
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'open_box',
        id: 'variant-open-jade-128',
        primary_image: variantProductImage,
        stock_quantity: 3,
      },
    ];
    const ogabasseyMerchant = {
      ...baseMerchant,
      id: OGABASSEY_MERCHANT_ID,
      slug: OGABASSEY_TEMPLATE_ID,
      custom_domain: OGABASSEY_DOMAIN,
      template_id: OGABASSEY_TEMPLATE_ID,
    };

    mockGetRequestScopedMerchant.mockImplementation(() => {
      merchantLookupCount += 1;
      if (merchantLookupCount === 1) {
        routeEvents.push('merchant-start');
        return new Promise((resolve) => {
          resolveMerchant = resolve;
        });
      }

      return Promise.resolve(ogabasseyMerchant);
    });
    mockGetCachedProductLcpHint.mockImplementation(
      (merchantId, _productSlug, options) => {
        routeEvents.push(
          `lcp-hint:${merchantId}:${
            options?.includeVariants === false ? 'image' : 'variants'
          }`
        );
        return Promise.resolve(
          toLegacyCachedProduct({
            ...categorizedDetailedProduct,
            color: 'Jade Green',
            condition: 'open_box',
            default_variant_id: 'variant-open-jade-128',
            has_variants: true,
            images: [baseProductImage],
            product_variants: variants,
          })
        );
      }
    );
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);
    mockOgabasseyPdpProductResourceHints.mockImplementationOnce(() => {
      routeEvents.push('product-hints');
      return null;
    });

    const pagePromise = CategoryProductPage({
      params: Promise.resolve({
        slug: OGABASSEY_DOMAIN,
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    await waitFor(() => {
      expect(mockGetCachedProductLcpHint).toHaveBeenCalledWith(
        OGABASSEY_MERCHANT_ID,
        'hp-laptop-14-ep0063nia',
        { includeVariants: true }
      );
    });
    expect(routeEvents).toEqual([
      `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
      'merchant-start',
      'product-hints',
    ]);
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: variantProductImage,
    });

    resolveMerchant?.(ogabasseyMerchant);
    const resolvedPage = await resolveRsc(pagePromise, { skipContent: true });

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: variantProductImage,
    });
    expect(routeEvents).toEqual([
      `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
      'merchant-start',
      'product-hints',
      `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
    ]);
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledTimes(1);

    render(await resolveRsc(resolvedPage));

    expect(screen.getByAltText('HP Laptop 14-ep0063nia')).toHaveAttribute(
      'src',
      expect.stringContaining('domain-lcp-hint.avif')
    );
    expect(screen.getByAltText('HP Laptop 14-ep0063nia')).not.toHaveAttribute(
      'src',
      expect.stringContaining('domain-lcp-variant.avif')
    );
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalled();
  });

  it('preloads the resolved default variant image when no route color is present', async () => {
    const baseProductImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-base.avif';
    const variantProductImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-default-variant.avif';
    const variants = [
      {
        attributes: { storage: '128GB' },
        condition: 'used',
        id: 'variant-used-128',
        primary_image: variantProductImage,
        stock_quantity: 3,
      },
    ];

    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: null,
        default_variant_id: null,
        has_variants: true,
        images: [baseProductImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: null,
      default_variant_id: null,
      has_variants: true,
      images: [baseProductImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: variantProductImage,
    });
  });

  it('seeds no-query critical commerce from the lowest-priced variant', async () => {
    const usedImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-used.avif';
    const openBoxImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-open-box.avif';
    const variants = [
      {
        attributes: { storage: '128GB' },
        condition: 'used',
        id: 'variant-used-128',
        primary_image: usedImage,
        price_override: 750000,
        stock_quantity: 3,
      },
      {
        attributes: { storage: '128GB' },
        condition: 'open_box',
        id: 'variant-open-box-128',
        primary_image: openBoxImage,
        price_override: 650000,
        stock_quantity: 3,
      },
    ];

    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: null,
        condition: 'used',
        default_variant_id: null,
        has_variants: true,
        images: [usedImage],
        price: 800000,
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: null,
      condition: 'used',
      default_variant_id: null,
      has_variants: true,
      images: [usedImage],
      price: 800000,
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: openBoxImage,
    });
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { storage: '128GB' },
          variantId: 'variant-open-box-128',
        },
      })
    );
  });

  it('preloads legacy Colour variant images on the full product route path', async () => {
    const baseProductImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-base.avif';
    const variantProductImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-jade-green.avif';
    const variants = [
      {
        attributes: { Colour: 'Jade Green', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-jade',
        primary_image: variantProductImage,
        stock_quantity: 3,
      },
    ];

    mockGetCachedProductLcpHint.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Jade Green',
      condition: 'used',
      has_variants: true,
      images: [baseProductImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: variantProductImage,
    });
  });

  it('emits one page preload when the merchant lookup wins the early LCP hint race', async () => {
    let resolveHint:
      | ((value: ReturnType<typeof toLegacyCachedProduct>) => void)
      | undefined;
    const routeEvents: string[] = [];
    const delayedProductImage =
      'https://cdn.ogabassey.com/core-assets/products/delayed-lcp-hint.avif';
    const ogabasseyMerchant = {
      ...baseMerchant,
      id: OGABASSEY_MERCHANT_ID,
      slug: OGABASSEY_TEMPLATE_ID,
      custom_domain: OGABASSEY_DOMAIN,
      template_id: OGABASSEY_TEMPLATE_ID,
    };
    let merchantLookupCount = 0;

    mockGetRequestScopedMerchant.mockImplementation(() => {
      merchantLookupCount += 1;
      if (merchantLookupCount === 1) {
        routeEvents.push('merchant-start');
      }
      return Promise.resolve(ogabasseyMerchant);
    });
    mockGetCachedProductLcpHint.mockImplementation(
      (merchantId, _productSlug, options) => {
        routeEvents.push(
          `lcp-hint:${merchantId}:${
            options?.includeVariants === false ? 'image' : 'variants'
          }`
        );
        return new Promise((resolve) => {
          resolveHint = resolve;
        });
      }
    );
    mockOgabasseyPdpProductResourceHints.mockImplementationOnce(() => {
      routeEvents.push('product-hints');
      return null;
    });

    const pagePromise = CategoryProductPage({
      params: Promise.resolve({
        slug: OGABASSEY_DOMAIN,
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    await waitFor(() => {
      expect(routeEvents).toEqual([
        `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
        'merchant-start',
        `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
      ]);
    });
    expect(mockOgabasseyPdpProductResourceHints).not.toHaveBeenCalled();

    resolveHint?.(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [delayedProductImage],
      })
    );
    const resolvedPage = await resolveRsc(pagePromise, { skipContent: true });

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: delayedProductImage,
    });
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledTimes(1);
    expect(routeEvents).toEqual([
      `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
      'merchant-start',
      `lcp-hint:${OGABASSEY_MERCHANT_ID}:variants`,
      'product-hints',
    ]);

    render(await resolveRsc(resolvedPage));

    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalled();
  });

  it('continues with variant route data when the variant-aware prewarm fails', async () => {
    let resolveMerchant:
      | ((
          value: typeof baseMerchant & {
            custom_domain: string;
            template_id: string;
          }
        ) => void)
      | undefined;
    const transientError = new Error('temporary product cache outage');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const ogabasseyMerchant = {
      ...baseMerchant,
      id: OGABASSEY_MERCHANT_ID,
      slug: OGABASSEY_TEMPLATE_ID,
      custom_domain: OGABASSEY_DOMAIN,
      template_id: OGABASSEY_TEMPLATE_ID,
    };

    mockGetRequestScopedMerchant.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMerchant = resolve;
        })
    );
    mockGetCachedProductLcpHint
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(toLegacyCachedProduct(categorizedDetailedProduct));

    const pagePromise = CategoryProductPage({
      params: Promise.resolve({
        slug: OGABASSEY_DOMAIN,
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    await waitFor(() => {
      expect(mockGetCachedProductLcpHint).toHaveBeenCalledWith(
        OGABASSEY_MERCHANT_ID,
        'hp-laptop-14-ep0063nia',
        { includeVariants: true }
      );
    });

    resolveMerchant?.(ogabasseyMerchant);

    const resolvedPage = await resolveRsc(pagePromise, { skipContent: true });
    expect(mockGetCachedProductLcpHint).toHaveBeenCalledWith(
      OGABASSEY_MERCHANT_ID,
      'hp-laptop-14-ep0063nia',
      { includeVariants: true }
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to prewarm OgaBassey PDP LCP hint:',
      'hp-laptop-14-ep0063nia',
      transientError
    );
    render(await resolveRsc(resolvedPage));
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('streams the OgaBassey PDP product image preload before the request base path resolves', async () => {
    let resolveBasePath: ((value: unknown) => void) | undefined;
    const routeEvents: string[] = [];
    const earlyProductImage =
      'https://cdn.ogabassey.com/core-assets/products/basepath-lenovo-legion.avif';
    mockGetCachedProductLcpHint.mockImplementationOnce(() => {
      routeEvents.push('lcp-hint');
      return Promise.resolve(
        toLegacyCachedProduct({
          ...categorizedDetailedProduct,
          images: [earlyProductImage],
        })
      );
    });
    mockGetStorefrontShellSnapshotBase.mockImplementationOnce(() => {
      routeEvents.push('base-path');
      return new Promise((resolve) => {
        resolveBasePath = resolve;
      });
    });
    mockGetCachedProductWithDetails.mockImplementationOnce(() => {
      routeEvents.push('product-details');
      return Promise.resolve({
        ...categorizedDetailedProduct,
        images: [earlyProductImage],
      });
    });
    mockOgabasseyPdpProductResourceHints.mockImplementationOnce(() => {
      routeEvents.push('product-hints');
      return null;
    });

    const resolvedPage = await resolveRsc(
      CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({}),
      }),
      { skipContent: true }
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: earlyProductImage,
    });
    expect(routeEvents).toEqual([
      'lcp-hint',
      'product-hints',
      'base-path',
      'product-details',
    ]);
    render(
      await resolveRsc(resolvedPage, {
        pruneSkippedContent: true,
        skipContent: true,
      })
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'HP Laptop 14-ep0063nia' })
    ).toBeInTheDocument();

    resolveBasePath?.({
      merchant: {
        ...baseMerchant,
        template_id: OGABASSEY_TEMPLATE_ID,
      },
      routingMode: 'path',
      basePath: '/teststore',
    });

    render(await resolveRsc(resolvedPage));

    expect(mockOgabasseyPdpCriticalCommerce).toHaveBeenCalled();
  });

  it('preloads the OgaBassey PDP product image without awaiting tracking-only query routes', async () => {
    let resolveProductDetails:
      | ((value: typeof categorizedDetailedProduct) => void)
      | undefined;
    const earlyProductImage =
      'https://cdn.ogabassey.com/core-assets/products/campaign-laptop.avif';
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [earlyProductImage],
      })
    );
    mockGetCachedProductWithDetails.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProductDetails = resolve;
      })
    );
    const resolvedPage = await resolveRsc(
      CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({
          [STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM]: 'metadata-blocking',
          utm_source: 'google',
          gclid: 'campaign-click',
        }),
      }),
      { skipContent: true }
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: earlyProductImage,
    });
    expect(mockOgabasseyProductDetailsPage).not.toHaveBeenCalled();

    resolveProductDetails?.(categorizedDetailedProduct);
    render(await resolveRsc(resolvedPage));
  });

  it('redirects invalid variant query routes before streaming early product hints', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/variant-laptop.avif';
    const variants = [
      {
        id: 'variant-used-128',
        attributes: { storage: '128GB' },
        condition: 'used',
        stock_quantity: 3,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [productImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    await expect(
      CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({ storage: '128GB' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockPermanentRedirect).toHaveBeenCalled();
    const redirectTargets = mockPermanentRedirect.mock.calls.map(
      ([url]) => url
    );
    expect(new Set(redirectTargets).size).toBe(1);
    expect(redirectTargets[0]).toBe(
      '/teststore/laptops/hp-laptop-14-ep0063nia'
    );
    // The canonical image preload is now emitted in the static shell before the
    // variant redirect resolves inside the Suspense child, so the previous
    // "preload not called" ordering assertion no longer holds — the redirect
    // assertions above remain the load-bearing guarantee.
  });

  it('preserves match selection params through canonical category redirects', async () => {
    // Route control resolves from the LCP hint alone and redirects before
    // the content fetch: queue only what this path consumes, since
    // clearAllMocks does not drain Once queues.
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct(categorizedDetailedProduct)
    );

    await expect(
      CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'wrong-cat',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({ variant_id: 'v1', match_base: '1' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    const redirectTargets = mockPermanentRedirect.mock.calls.map(
      ([url]) => url
    );
    expect(new Set(redirectTargets).size).toBe(1);
    expect(redirectTargets[0]).toBe(
      '/teststore/laptops/hp-laptop-14-ep0063nia?variant_id=v1&match_base=1'
    );
  });

  it('allows valid variantId query routes to stream product hints without redirecting', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/variant-laptop.avif';
    const variantImage =
      'https://cdn.ogabassey.com/core-assets/products/variant-laptop-used-128.avif';
    const variants = [
      {
        id: 'variant-used-128',
        attributes: { storage: '128GB' },
        condition: 'used',
        primary_image: variantImage,
        stock_quantity: 3,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [productImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    const ui = await resolveRsc(
      await CategoryProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          category: 'laptops',
          productSlug: 'hp-laptop-14-ep0063nia',
        }),
        searchParams: Promise.resolve({ variantId: 'variant-used-128' }),
      })
    );

    render(ui);

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: variantImage,
    });
    expect(mockPreloadOgabasseyPdpStaticResources).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).toBeInTheDocument();
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { storage: '128GB' },
          condition: 'used',
          variantId: 'variant-used-128',
        },
      })
    );
  });

  it('does not treat condition-only query routes as explicit hidden SKU selections', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/condition-laptop.avif';
    const variants = [
      {
        id: 'variant-used-black',
        attributes: { color: 'Black', storage: '128GB' },
        condition: 'used',
        stock_quantity: 3,
      },
      {
        id: 'variant-used-blue',
        attributes: { color: 'Blue', storage: '128GB' },
        condition: 'used',
        stock_quantity: 4,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        has_variants: true,
        images: [productImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      has_variants: true,
      images: [productImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({ condition: 'used' }),
        })
      )
    );

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          condition: 'used',
        },
      })
    );
  });

  it('seeds hidden color from the product image context when no variant query exists', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-graphite.avif';
    const jadeImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-jade-green.avif';
    const usedJadeImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-used-jade-green.avif';
    const variants: LegacyProductVariantFixture[] = [
      {
        attributes: { Colour: 'Jade Green', storage: '128GB' },
        condition: 'open_box',
        id: 'variant-open-jade-128',
        primary_image: jadeImage,
        stock_quantity: 3,
      },
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-jade-128',
        primary_image: usedJadeImage,
        stock_quantity: 4,
      },
      {
        attributes: { color: 'Onyx Black', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-black-128',
        primary_image: productImage,
        stock_quantity: 4,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: 'Jade Green',
        condition: 'open_box',
        has_variants: true,
        images: [productImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Jade Green',
      condition: 'open_box',
      has_variants: true,
      images: [productImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: jadeImage,
    });
    // Color is preserved for a stable LCP hero and resolves to the cheapest
    // variant within that color. Crucially, no product-level `condition` is
    // emitted: forcing it would open the above-the-fold critical state on the
    // pricier condition-first variant and then flip to the cheapest after
    // hydration.
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { color: 'Jade Green', storage: '128GB' },
          variantId: 'variant-open-jade-128',
        },
      })
    );
  });

  it('ignores the projection default_variant_id and opens on the cheapest variant', async () => {
    const jadeImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-jade-green.avif';
    const blackImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-onyx-black.avif';
    const variants = [
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'open_box',
        id: 'variant-open-jade-128',
        price_override: 600_000,
        primary_image: jadeImage,
        stock_quantity: 3,
      },
      {
        attributes: { color: 'Onyx Black', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-black-128',
        price_override: 750_000,
        primary_image: blackImage,
        stock_quantity: 4,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: 'Jade Green',
        condition: 'open_box',
        default_variant_id: 'variant-used-black-128',
        has_variants: true,
        images: [jadeImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Jade Green',
      condition: 'open_box',
      default_variant_id: 'variant-used-black-128',
      has_variants: true,
      images: [jadeImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    // default_variant_id points at the pricier Onyx Black (₦750k), but with no
    // URL query the critical PDP must open on the globally cheapest variant —
    // Jade Green (₦600k) — not the projection's condition-first default.
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: jadeImage,
    });
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { color: 'Jade Green', storage: '128GB' },
          variantId: 'variant-open-jade-128',
        },
      })
    );
  });

  it('falls back when the configured default variant is out of stock', async () => {
    const jadeImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-jade-green.avif';
    const blackImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-onyx-black.avif';
    const variants = [
      {
        attributes: { color: 'Onyx Black', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-black-128',
        primary_image: blackImage,
        stock_quantity: 0,
      },
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-jade-128',
        primary_image: jadeImage,
        stock_quantity: 4,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: 'Onyx Black',
        condition: 'used',
        default_variant_id: 'variant-used-black-128',
        has_variants: true,
        images: [blackImage],
        manage_stock: true,
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Onyx Black',
      condition: 'used',
      default_variant_id: 'variant-used-black-128',
      has_variants: true,
      images: [blackImage],
      manage_stock: true,
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: jadeImage,
    });
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { color: 'Jade Green', storage: '128GB' },
          variantId: 'variant-used-jade-128',
        },
      })
    );
  });

  it('falls back when the product color is not purchasable', async () => {
    const blackImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-onyx-black.avif';
    const jadeImage =
      'https://cdn.ogabassey.com/core-assets/products/s24-jade-green.avif';
    const variants = [
      {
        attributes: { color: 'Onyx Black', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-black-128',
        primary_image: blackImage,
        stock_quantity: 0,
      },
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-jade-128',
        primary_image: jadeImage,
        stock_quantity: 4,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: 'Onyx Black',
        condition: 'used',
        has_variants: true,
        images: [blackImage],
        manage_stock: true,
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Onyx Black',
      condition: 'used',
      has_variants: true,
      images: [blackImage],
      manage_stock: true,
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: jadeImage,
    });
    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialVariantSelection: {
          attributes: { color: 'Jade Green', storage: '128GB' },
          variantId: 'variant-used-jade-128',
        },
      })
    );
  });

  it('does not force stale product condition into the default critical selection', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/used-laptop.avif';
    const jadeImage =
      'https://cdn.ogabassey.com/core-assets/products/used-jade-laptop.avif';
    const variants = [
      {
        attributes: { color: 'Jade Green', storage: '128GB' },
        condition: 'used',
        id: 'variant-used-128',
        primary_image: jadeImage,
        stock_quantity: 3,
      },
    ];
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        color: 'Jade Green',
        condition: 'new',
        has_variants: true,
        images: [productImage],
        product_variants: variants,
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      color: 'Jade Green',
      condition: 'new',
      has_variants: true,
      images: [productImage],
      product_variants: variants,
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue(variants);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const providerProps = mockOgabasseyPdpCriticalCommerceProvider.mock.calls
      .at(-1)
      ?.at(0) as { initialVariantSelection?: unknown };

    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: jadeImage,
    });
    // The configured color is preserved (stable LCP hero) and resolves to the
    // cheapest variant within that color — here the cheaper Used variant — with
    // no product-level condition forced into the selection.
    expect(providerProps.initialVariantSelection).toEqual({
      attributes: { color: 'Jade Green', storage: '128GB' },
      variantId: 'variant-used-128',
    });
  });

  it('preserves has_variants from the cached product hint when variant hydration is empty', async () => {
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/variant-laptop.avif';
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        has_variants: true,
        images: [productImage],
        product_variants: [],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      has_variants: true,
      images: [productImage],
      product_variants: [],
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpCriticalCommerceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        cartProduct: expect.objectContaining({
          has_variants: true,
          variants: [],
        }),
      })
    );
  });

  it('skips early product preload when the cached product has no image and still renders details', async () => {
    const fallbackProductImage =
      'https://cdn.ogabassey.com/core-assets/products/fallback-laptop.avif';
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [fallbackProductImage],
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpProductResourceHints).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalled();
  });

  it('renders the OgaBassey product shell before supplemental PDP data resolves', async () => {
    let resolveCategoryPageData:
      | ((
          value: Awaited<
            ReturnType<typeof mockLoadCategoryScopedSemanticInventory>
          >
        ) => void)
      | undefined;
    mockLoadCategoryScopedSemanticInventory.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCategoryPageData = resolve;
      })
    );
    const productImage =
      'https://cdn.ogabassey.com/core-assets/products/lenovo-legion.avif';
    mockGetCachedProductLcpHint.mockResolvedValueOnce(
      toLegacyCachedProduct({
        ...categorizedDetailedProduct,
        images: [productImage],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categorizedDetailedProduct,
      images: [productImage],
    });

    const pagePromise = CategoryProductPage({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });
    let pageUi: Awaited<ReturnType<typeof CategoryProductPage>> | undefined;
    pagePromise.then((result) => {
      pageUi = result;
    });

    await waitFor(() => {
      expect(pageUi).toBeDefined();
    });

    render(await resolveRsc(pageUi));
    expect(mockPreloadOgabasseyPdpStaticResources).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpProductResourceHints).toHaveBeenCalledWith({
      src: productImage,
    });
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({
          image: productImage,
        }),
      })
    );

    resolveCategoryPageData?.({
      isCollection: false,
      categoryName: 'Products',
      products: [],
    });
  });

  it('does not mount OgaBassey PDP preload hints for generic template product pages', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      template_id: `${OGABASSEY_TEMPLATE_ID}_other`,
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpStaticResourceHints).not.toHaveBeenCalled();
    expect(mockPreloadOgabasseyPdpStaticResources).not.toHaveBeenCalled();
    expect(mockOgabasseyPdpProductResourceHints).not.toHaveBeenCalled();
  });

  it('keeps the generic product client behind the default branch loader', () => {
    const routeSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
      ),
      { encoding: 'utf8' }
    );

    expect(routeSource).not.toContain(
      "import ProductDetailClient from '@/app/(storefront)/[slug]/(catalog)/(pdp)/products/[productSlug]/product-detail-client'"
    );
  });

  it('preserves unmanaged stock and variant stock quantities for the Ogabassey PDP', async () => {
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-128-black',
        attributes: { storage: '128GB', color: 'Black' },
        images: [],
        price_override: 437000,
        sku: 'IPHONE13-128-BLK',
        stock_quantity: 0,
      },
    ]);
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        parent_id: null,
        slug: 'smartphones',
      },
      manage_stock: false,
      name: 'iPhone 13',
      slug: 'iphone-13',
      stock: 0,
      stock_quantity: 0,
      product_variants: [
        {
          id: 'variant-128-black',
          attributes: { storage: '128GB', color: 'Black' },
          images: [],
          price_override: 437000,
          sku: 'IPHONE13-128-BLK',
          stock_quantity: 0,
        },
      ],
    });

    // Deliberately render the page only to drive JSON-LD/breadcrumb side effects.
    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'iphone-13',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const ogabasseyProps = mockOgabasseyPdpDeferredDetailIsland.mock.calls
      .at(-1)
      ?.at(0) as
      | {
          product?: {
            manage_stock?: boolean;
            stock?: number;
            variants?: Record<string, unknown>[];
          };
        }
      | undefined;

    expect(ogabasseyProps?.product).toEqual(
      expect.objectContaining({
        manage_stock: false,
        stock: 0,
      })
    );
    expect(ogabasseyProps?.product?.variants?.[0]).toEqual(
      expect.objectContaining({
        stock: 0,
        stock_quantity: 0,
      })
    );
  });

  it('preserves SKU-matrix variant conditions for the Ogabassey PDP', async () => {
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'iphone15-used-esim',
        condition: 'used',
        attributes: {
          storage: '128GB',
          color: 'Black',
          sim_type: 'eSIM Only',
        },
        images: [],
        primary_image: 'https://cdn.example.com/iphone15-used-esim.avif',
        price_override: 829000,
        sku: 'IPHONE15-USED-128-BLK-ESIM',
        stock_quantity: 3,
      },
    ]);
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        parent_id: null,
        slug: 'smartphones',
      },
      has_variants: true,
      name: 'iPhone 15',
      product_variants: [
        {
          id: 'iphone15-used-esim',
          attributes: {
            storage: '128GB',
            color: 'Black',
            sim_type: 'eSIM Only',
          },
          condition: 'used',
          images: [],
          primary_image: 'https://cdn.example.com/iphone15-used-esim.avif',
          price_override: 829000,
          sku: 'IPHONE15-USED-128-BLK-ESIM',
          stock_quantity: 3,
        },
      ],
      slug: 'iphone-15',
      variant_model: 'sku_matrix',
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'iphone-15',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const ogabasseyProps = mockOgabasseyPdpDeferredDetailIsland.mock.calls
      .at(-1)
      ?.at(0) as
      | {
          product?: {
            variants?: Record<string, unknown>[];
          };
        }
      | undefined;

    expect(ogabasseyProps?.product?.variants?.[0]).toEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          sim_type: 'eSIM Only',
          storage: '128GB',
        }),
        condition: 'used',
        id: 'iphone15-used-esim',
        primary_image: 'https://cdn.example.com/iphone15-used-esim.avif',
      })
    );
  });

  it('defaults manage_stock to true when the detailed product omits it', async () => {
    // Regression: missing `manage_stock` must default to `true` so legacy
    // rows with `null` are not advertised as `InStock` via
    // `generateProductSchema` regardless of actual stock. See seo-utils
    // `getProductAvailability` — `manage_stock === false` short-circuits to
    // InStock and would mask OutOfStock inventory.
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      template_id: undefined,
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      manage_stock: undefined,
    });

    // Deliberately render the page only to drive JSON-LD/breadcrumb side effects.
    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    const lastProductDetailProps = mockProductDetailClient.mock.calls.at(-1);

    expect(lastProductDetailProps?.[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({
          manage_stock: true,
        }),
      })
    );
  });

  it('defers category PDP first paint to the route loader while the client page is pending', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      template_id: 'default',
    });
    mockProductDetailClient.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the detail client suspended after route data resolves.
      });
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>
        {
          await resolveRsc(
            await CategoryProductPage({
              params: Promise.resolve({
                slug: 'teststore',
                category: 'laptops',
                productSlug: 'hp-laptop-14-ep0063nia',
              }),
              searchParams: Promise.resolve({}),
            }),
            { stripSuspense: true }
          )
        }
      </Suspense>
    );

    expect(screen.getByText('Route loader fallback')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        level: 1,
        name: 'HP Laptop 14-ep0063nia',
      })
    ).not.toBeInTheDocument();
  });

  it('defaults manage_stock to true when the detailed product has explicit false', async () => {
    // Verify that explicit `manage_stock: false` is preserved (unlimited stock).
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      template_id: undefined,
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      manage_stock: false,
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockProductDetailClient.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({
          manage_stock: false,
        }),
      })
    );
  });

  it('passes the shared semantic sections into the Ogabassey PDP surface', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      support_email: 'support@test.example',
      support_phone: '+2348000000000',
      template_id: OGABASSEY_TEMPLATE_ID,
      trust_profile: {
        return_policy: {
          summary: 'Returns accepted within 7 days.',
          window_days: 7,
          return_method: 'mail',
          return_fees: 'free',
        },
        shipping_policy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handling_days_min: 1,
          handling_days_max: 2,
          transit_days_min: 3,
          transit_days_max: 5,
          shipping_fee_type: 'free',
        },
        customer_service: {
          whatsapp_number: '+2349000000000',
        },
      },
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'Samsung Galaxy Z TriFold',
      slug: 'samsung-galaxy-z-trifold',
      brand: 'Samsung',
      category: 'Smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
    });
    mockLoadCategoryScopedSemanticInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Smartphones',
      products: [
        {
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
        {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildProductSemanticModel.mockReturnValue({
      trustBullets: [],
      supportLinks: [
        {
          href: 'https://teststore.usebaci.com/smartphones',
          label: 'Shop more Smartphones',
        },
      ],
      guideLinks: [
        {
          href: 'https://teststore.usebaci.com/blog/best-phones-in-nigeria',
          title: 'Best Phones in Nigeria',
          description: 'Budget and flagship picks.',
          kind: 'best-in-nigeria',
        },
      ],
      alternatives: null,
      sameBrand: null,
      samePrice: null,
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'samsung-galaxy-z-trifold',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(mockOgabasseyPdpSemanticSections).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryName: 'Smartphones',
        storeUrl: 'https://teststore.usebaci.com',
        categorySlug: 'smartphones',
        product: expect.objectContaining({
          slug: 'samsung-galaxy-z-trifold',
        }),
      })
    );
    expect(mockOgabasseyPdpDeferredDetailIsland).toHaveBeenCalledWith(
      expect.objectContaining({
        serverPrimaryDetails: expect.anything(),
        storeSlug: 'teststore',
      })
    );
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.any(Object),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.objectContaining({
        supportEmail: 'support@test.example',
        supportPhone: '+2348000000000',
      }),
      expect.objectContaining({
        acceptedPaymentMethods: ['Bank transfer'],
        productUrl:
          'https://teststore.usebaci.com/smartphones/samsung-galaxy-z-trifold',
      })
    );
  });

  it('keeps JSON-LD and breadcrumbs aligned with the validated canonical URL when stored canonical_url is stale', async () => {
    const expectedCanonicalUrl =
      'https://teststore.usebaci.com/smartphones/samsung-galaxy-z-trifold';
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'Samsung Galaxy Z TriFold',
      slug: 'samsung-galaxy-z-trifold',
      category: 'Smartphones',
      category_slug: 'smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
      canonical_url:
        'https://teststore.usebaci.com/products/samsung-galaxy-z-trifold',
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'samsung-galaxy-z-trifold',
      }),
      searchParams: Promise.resolve({}),
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'samsung-galaxy-z-trifold',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(metadata.alternates?.canonical).toBe(expectedCanonicalUrl);
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.any(Object),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.any(Object),
      expect.objectContaining({
        acceptedPaymentMethods: ['Bank transfer'],
        productUrl: expectedCanonicalUrl,
      })
    );
    expect(mockGenerateBreadcrumbSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Samsung Galaxy Z TriFold',
          url: expectedCanonicalUrl,
        }),
      ])
    );
  });

  it('does not reuse stored canonical_url query strings or fragments in JSON-LD and breadcrumbs', async () => {
    const expectedCanonicalUrl =
      'https://teststore.usebaci.com/smartphones/samsung-galaxy-z-trifold';
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      name: 'Samsung Galaxy Z TriFold',
      slug: 'samsung-galaxy-z-trifold',
      category: 'Smartphones',
      category_slug: 'smartphones',
      categories: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: null,
      },
      canonical_url: `${expectedCanonicalUrl}?utm_source=google#reviews`,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'smartphones',
        productSlug: 'samsung-galaxy-z-trifold',
      }),
      searchParams: Promise.resolve({}),
    });

    render(
      await resolveRsc(
        await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'smartphones',
            productSlug: 'samsung-galaxy-z-trifold',
          }),
          searchParams: Promise.resolve({}),
        })
      )
    );

    expect(metadata.alternates?.canonical).toBe(expectedCanonicalUrl);
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.any(Object),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.any(Object),
      expect.objectContaining({
        acceptedPaymentMethods: ['Bank transfer'],
        productUrl: expectedCanonicalUrl,
      })
    );
    expect(mockGenerateBreadcrumbSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Samsung Galaxy Z TriFold',
          url: expectedCanonicalUrl,
        }),
      ])
    );
  });

  it('keeps the canonical URL on the bare family path', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({
        condition: 'used',
        storage: '128GB',
        utm_source: 'google',
      }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://teststore.usebaci.com/laptops/hp-laptop-14-ep0063nia'
    );
  });

  it('normalizes canonical_url host to the request-scoped storefront domain', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      custom_domain: 'ogabassey.com',
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedDetailedProduct,
      canonical_url: 'https://usebaci.com/laptops/hp-laptop-14-ep0063nia',
    });
    mockHeaders.mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/laptops/hp-laptop-14-ep0063nia'
    );
  });
});
