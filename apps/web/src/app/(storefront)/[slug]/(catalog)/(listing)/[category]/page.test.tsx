import { render, screen, waitFor } from '@testing-library/react';
import { type ReactElement, Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptions,
  getCachedMerchant,
  getCachedMerchantByDomain,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';

const NORMALIZED_PLACEHOLDER_IMAGE = '/placeholder.svg';
const mockGetPublishedClusterPosts = vi.fn();
const mockGetCachedProductSemanticInventory = vi.fn();
const mockCategoryPageDeferredCompareLinks = vi.hoisted(() => vi.fn());
const mockConnection = vi.hoisted(() => vi.fn());
const { mockCategoryPageContent } = vi.hoisted(() => ({
  mockCategoryPageContent: vi.fn((_props: unknown) => (
    <div>Category page content</div>
  )),
}));

function defaultCategoryPageImplementation({
  currentPage,
  hubContent,
}: {
  currentPage?: number;
  hubContent?: CategoryHubModel;
}) {
  return (
    <div>
      <div>Current page: {currentPage}</div>
      <div>Hub heading: {hubContent?.intro.heading ?? 'none'}</div>
      {hubContent?.bestForCards.map((card) => (
        <div key={`best-for-${card.title}-${card.href}`}>
          Best for: {card.title}
        </div>
      ))}
      {hubContent?.brandCards.map((card) => (
        <div key={`brand-${card.title}-${card.href}`}>
          <div>Brand: {card.title}</div>
          {card.secondaryLabel ? (
            <div>Brand compare: {card.secondaryLabel}</div>
          ) : null}
        </div>
      ))}
      {hubContent?.priceBandCards.map((card) => (
        <div key={`price-band-${card.title}-${card.href}`}>
          Price band: {card.title}
        </div>
      ))}
      {hubContent?.comparisonLinks.map((link) => (
        <div key={`compare-link-${link.label}-${link.href}`}>
          Compare link: {link.label}
        </div>
      ))}
      {hubContent?.guideLinks.map((link) => (
        <div key={`guide-link-${link.title}-${link.href}`}>
          Guide link: {link.title}
        </div>
      ))}
      {hubContent?.faqItems.map((item) => (
        <div key={`faq-${item.question}-${item.answer}`}>
          FAQ: {item.question}
        </div>
      ))}
    </div>
  );
}

const categoryPageSpy = vi.fn(defaultCategoryPageImplementation);
const mockBuildStoreUrl = vi.fn();
const mockBuildRequestScopedStoreUrl = vi.fn();
const mockGenerateBreadcrumbSchema = vi.fn(() => ({}));
const mockGenerateCollectionPageSchema = vi.fn(() => ({}));
const mockGenerateFAQSchema = vi.fn((faqItems) => ({
  '@type': 'FAQPage',
  mainEntity: faqItems,
}));

vi.mock('@/components/storefront/ogabassey/pages/category-page', () => ({
  // The route now composes hub content as a server-rendered `hubSections`
  // ReactNode slot (`<CategoryHubSections hub={…} />`) instead of a raw
  // `hubContent` prop. Unwrap the element's `hub` prop back into `hubContent`
  // so the spy-based assertions keep validating what the route composed.
  CategoryPage: (props: {
    currentPage?: number;
    hubSections?: ReactElement<{ hub?: CategoryHubModel }>;
  }) =>
    categoryPageSpy({
      ...props,
      hubContent: props.hubSections?.props?.hub,
    }),
}));

vi.mock('./category-page-deferred-compare-links', () => ({
  CategoryPageDeferredCompareLinks: (props: { categorySlug: string }) => {
    mockCategoryPageDeferredCompareLinks(props);

    return <section>Maintained category compare links</section>;
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/commercial-support-links',
  () => ({
    CommercialSupportLinks: () => <div>CommercialSupportLinks footer</div>,
  })
);

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: vi.fn(),
  getCachedCategoryPageGraphicsOptions: vi.fn(),
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('@/lib/normalize-product', () => ({
  normalizeProduct: (product: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    price: number;
    image: string;
    images?: string[];
    category?: string | null;
    brand?: string | null;
    condition?: string | null;
    stock?: number | null;
    product_key_specs?: Record<string, unknown> | null;
    category_slug?: string | null;
  }) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description ?? '',
    price: product.price,
    image: product.image || product.images?.[0] || NORMALIZED_PLACEHOLDER_IMAGE,
    images: product.images ?? [product.image],
    category: product.category ?? 'Smartphones',
    brand: product.brand ?? null,
    condition: product.condition ?? 'new',
    stock: product.stock ?? 0,
    product_key_specs: product.product_key_specs ?? null,
    category_slug: product.category_slug ?? 'smartphones',
  }),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/seo-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-utils')>();

  return {
    ...actual,
    generateBreadcrumbSchema: (
      ...args: Parameters<typeof mockGenerateBreadcrumbSchema>
    ) => mockGenerateBreadcrumbSchema(...args),
    generateCollectionPageSchema: (
      ...args: Parameters<typeof mockGenerateCollectionPageSchema>
    ) => mockGenerateCollectionPageSchema(...args),
    generateFAQSchema: (...args: Parameters<typeof mockGenerateFAQSchema>) =>
      mockGenerateFAQSchema(...args),
    generateMetaDescription: (description: string) =>
      description.replace(/<[^>]+>/g, '').trim(),
    getIndexableRobotsMetadata: (
      ...args: Parameters<typeof actual.getIndexableRobotsMetadata>
    ) => actual.getIndexableRobotsMetadata(...args),
  };
});

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (...args: unknown[]) => mockBuildStoreUrl(...args),
  buildRequestScopedStoreUrl: (...args: unknown[]) =>
    mockBuildRequestScopedStoreUrl(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

vi.mock(
  '@/lib/storefront-product/get-cached-product-semantic-inventory',
  () => ({
    getCachedProductSemanticInventory: (...args: unknown[]) =>
      mockGetCachedProductSemanticInventory(...args),
  })
);

vi.mock('@/lib/storefront-category/get-cached-brand-authority-entries', () => ({
  getCachedBrandAuthorityEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('./category-page-content', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./category-page-content')>();

  return {
    ...actual,
    CategoryPageContent: (props: unknown) => mockCategoryPageContent(props),
  };
});

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const merchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'test-store',
  custom_domain: null,
  payout_currency: 'NGN',
  site_description: 'Store description',
  logo_url: null,
};

function makeSmartphoneProduct(
  index: number,
  overrides: Partial<{
    name: string;
    slug: string;
    brand: string;
    price: number;
    main_camera_mp: number;
    battery_mah: number;
    charging_watt: number;
    ram_gb: number;
    storage_gb: number;
    screen_size_inches: number;
  }> = {}
) {
  return {
    id: `product-${index}`,
    name: overrides.name ?? `Phone ${index}`,
    slug: overrides.slug ?? `phone-${index}`,
    description: `Description ${index}`,
    price: overrides.price ?? 300000 + index * 1000,
    image: `https://cdn.example.com/product-${index}.png`,
    images: [`https://cdn.example.com/product-${index}.png`],
    category: 'Smartphones',
    brand: overrides.brand ?? 'Tecno',
    condition: 'new',
    stock: 5,
    category_slug: 'smartphones',
    product_key_specs: {
      main_camera_mp: overrides.main_camera_mp ?? 48,
      battery_mah: overrides.battery_mah ?? 5000,
      charging_watt: overrides.charging_watt ?? 33,
      ram_gb: overrides.ram_gb ?? 8,
      storage_gb: overrides.storage_gb ?? 128,
      screen_size_inches: overrides.screen_size_inches ?? 6.6,
    },
  };
}

const smartphoneHubProducts = [
  makeSmartphoneProduct(1, {
    name: 'Alpha Phone',
    slug: 'alpha-phone',
    brand: 'Apple',
    price: 420000,
    main_camera_mp: 50,
    battery_mah: 5000,
    charging_watt: 33,
  }),
  makeSmartphoneProduct(2, {
    name: 'Beta Phone',
    slug: 'beta-phone',
    brand: 'Samsung',
    price: 460000,
    main_camera_mp: 64,
    battery_mah: 6000,
    charging_watt: 45,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(3, {
    name: 'Apple Mini',
    slug: 'apple-mini',
    brand: 'Apple',
    price: 390000,
    main_camera_mp: 48,
    battery_mah: 4700,
  }),
  makeSmartphoneProduct(4, {
    name: 'Apple Pro',
    slug: 'apple-pro',
    brand: 'Apple',
    price: 490000,
    main_camera_mp: 108,
    battery_mah: 6000,
    charging_watt: 45,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(5, {
    name: 'Samsung A',
    slug: 'samsung-a',
    brand: 'Samsung',
    price: 350000,
    main_camera_mp: 48,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(6, {
    name: 'Samsung B',
    slug: 'samsung-b',
    brand: 'Samsung',
    price: 480000,
    main_camera_mp: 50,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(7, {
    name: 'Tecno C',
    slug: 'tecno-c',
    brand: 'Tecno',
    price: 470000,
    main_camera_mp: 32,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(8, {
    name: 'Tecno Spark',
    slug: 'tecno-spark',
    brand: 'Tecno',
    price: 220000,
  }),
  makeSmartphoneProduct(9, {
    name: 'Infinix Zero',
    slug: 'infinix-zero',
    brand: 'Infinix',
    price: 240000,
    charging_watt: 45,
  }),
  makeSmartphoneProduct(10, {
    name: 'Xiaomi Redmi',
    slug: 'xiaomi-redmi',
    brand: 'Xiaomi',
    price: 260000,
    battery_mah: 5100,
  }),
  makeSmartphoneProduct(11, {
    name: 'Nokia G',
    slug: 'nokia-g',
    brand: 'Nokia',
    price: 280000,
    main_camera_mp: 50,
  }),
  makeSmartphoneProduct(12, {
    name: 'Itel Vision',
    slug: 'itel-vision',
    brand: 'Itel',
    price: 180000,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(13, {
    name: 'Oppo Reno',
    slug: 'oppo-reno',
    brand: 'Oppo',
    price: 620000,
    main_camera_mp: 50,
    charging_watt: 65,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(14, {
    name: 'Vivo V',
    slug: 'vivo-v',
    brand: 'Vivo',
    price: 710000,
    main_camera_mp: 64,
    battery_mah: 5000,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(15, {
    name: 'Pixel Prime',
    slug: 'pixel-prime',
    brand: 'Google',
    price: 890000,
    main_camera_mp: 50,
    battery_mah: 5000,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(16, {
    name: 'Motorola Edge',
    slug: 'motorola-edge',
    brand: 'Motorola',
    price: 530000,
    charging_watt: 68,
  }),
  makeSmartphoneProduct(17, {
    name: 'Honor Magic',
    slug: 'honor-magic',
    brand: 'Honor',
    price: 580000,
    main_camera_mp: 54,
    battery_mah: 5100,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(18, {
    name: 'Huawei Nova',
    slug: 'huawei-nova',
    brand: 'Huawei',
    price: 640000,
    main_camera_mp: 50,
    battery_mah: 5000,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(19, {
    name: 'Realme GT',
    slug: 'realme-gt',
    brand: 'Realme',
    price: 520000,
    battery_mah: 5000,
    charging_watt: 80,
  }),
  makeSmartphoneProduct(20, {
    name: 'OnePlus Ace',
    slug: 'oneplus-ace',
    brand: 'OnePlus',
    price: 760000,
    main_camera_mp: 50,
    battery_mah: 5100,
    charging_watt: 100,
  }),
  makeSmartphoneProduct(21, {
    name: 'Nothing Phone',
    slug: 'nothing-phone',
    brand: 'Nothing',
    price: 690000,
    main_camera_mp: 50,
    battery_mah: 4700,
    charging_watt: 45,
  }),
];

const headphoneProducts = [
  {
    ...makeSmartphoneProduct(31, {
      name: 'Sony Headphone',
      slug: 'sony-headphone',
      brand: 'Sony',
      price: 45000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(32, {
      name: 'Anker Headphone',
      slug: 'anker-headphone',
      brand: 'Anker',
      price: 55000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(33, {
      name: 'JBL Headphone',
      slug: 'jbl-headphone',
      brand: 'JBL',
      price: 65000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(34, {
      name: 'Nokia Headphone',
      slug: 'nokia-headphone',
      brand: 'Nokia',
      price: 75000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
];

const categoryPageData = {
  category: {
    id: 'cat-1',
    name: 'Smartphones',
    slug: 'smartphones',
    seo_heading: null,
    seo_description: null,
    seo_features: [],
    seo_faq: [],
    image_url: null,
    parent: null,
  },
  products: smartphoneHubProducts,
  isCollection: false,
  fallbackName: 'Smartphones',
  fallbackDescription: 'Shop smartphones',
  seo: null,
  name: null,
};

const { default: CategoryPageRoute, generateMetadata } = await import('./page');
const actualCategoryPageContentModule = await vi.importActual<
  typeof import('./category-page-content')
>('./category-page-content');

function getLastHubContent() {
  const lastCall = categoryPageSpy.mock.calls.at(-1)?.[0] as
    | { hubContent?: CategoryHubModel }
    | undefined;
  return lastCall?.hubContent;
}

function getLastCategoryPageProps() {
  return categoryPageSpy.mock.calls.at(-1)?.[0] as
    | {
        products?: Array<{ condition?: string }>;
        hubContent?: CategoryHubModel;
      }
    | undefined;
}

describe('category page route', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    vi.mocked(getCachedMerchantByDomain).mockReset();
    vi.mocked(getMerchantByIdentifier).mockReset();
    vi.mocked(getCachedCategoryPageData).mockReset();
    vi.mocked(getCachedCategoryPageGraphicsOptions).mockReset();
    categoryPageSpy.mockClear();
    categoryPageSpy.mockImplementation(defaultCategoryPageImplementation);
    notFound.mockClear();
    mockGenerateBreadcrumbSchema.mockClear();
    mockGenerateCollectionPageSchema.mockClear();
    mockGenerateFAQSchema.mockClear();
    mockGetPublishedClusterPosts.mockReset();
    mockGetCachedProductSemanticInventory.mockReset();
    mockCategoryPageDeferredCompareLinks.mockReset();
    mockConnection.mockReset();
    mockCategoryPageContent.mockReset();
    mockCategoryPageContent.mockImplementation(() => (
      <div>Category page content</div>
    ));

    vi.mocked(getCachedMerchant).mockResolvedValue(
      merchant as unknown as Awaited<ReturnType<typeof getCachedMerchant>>
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(
      merchant as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>
    );
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    mockBuildStoreUrl.mockReset();
    mockBuildStoreUrl.mockImplementation(
      (mockMerchant: { slug: string; custom_domain?: string | null }) =>
        mockMerchant.custom_domain
          ? `https://${mockMerchant.custom_domain}`
          : `https://${mockMerchant.slug}.usebaci.com`
    );
    mockBuildRequestScopedStoreUrl.mockReset();
    mockBuildRequestScopedStoreUrl.mockImplementation(
      (mockMerchant: { slug: string; custom_domain?: string | null }) =>
        mockMerchant.custom_domain
          ? `https://${mockMerchant.custom_domain}`
          : `https://${mockMerchant.slug}.usebaci.com`
    );
    vi.mocked(getCachedCategoryPageData).mockResolvedValue(
      categoryPageData as unknown as Awaited<
        ReturnType<typeof getCachedCategoryPageData>
      >
    );
    vi.mocked(getCachedCategoryPageGraphicsOptions).mockResolvedValue([]);
    mockGetPublishedClusterPosts.mockResolvedValue([
      {
        slug: 'best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
        excerpt: 'Budget and flagship picks.',
        category: 'Smartphones',
        tags: ['smartphones', 'budget'],
        keywords: ['android'],
        featured_image_url: null,
        published_at: '2026-04-10T09:00:00.000Z',
        reading_time_minutes: 6,
      },
    ]);
    mockGetCachedProductSemanticInventory.mockImplementation(
      (_merchantId: string, categorySlug: string) =>
        categorySlug === 'smartphones' ? smartphoneHubProducts : []
    );
  });

  it('keeps the route shell stable and shows the catalog skeleton while category content is suspended', () => {
    mockCategoryPageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the category page content suspended behind the page fallback.
      });
    });

    const ui = CategoryPageRoute({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({}),
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>{ui}</Suspense>
    );

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Route loader fallback')).not.toBeInTheDocument();
    expect(screen.queryByText('Category page content')).not.toBeInTheDocument();
    expect(mockConnection).toHaveBeenCalledOnce();
  });

  it('keeps category listings request-bound behind a static-shell fallback', async () => {
    const ui = CategoryPageRoute({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    await waitFor(() => expect(mockConnection).toHaveBeenCalledOnce());
  });

  it('renders curated smartphone hub content when merchant-authored SEO is absent', async () => {
    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(await screen.findByText('Current page: 1')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Hub heading: ${CATEGORY_HUB_DEFAULTS.smartphones.intro.heading}`
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Best for: Best for Photography')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Best for: Best for Battery Life')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Best for: Best Budget Phones')
    ).toBeInTheDocument();
    expect(screen.getByText('Brand: Apple')).toBeInTheDocument();
    expect(screen.getByText('Brand: Samsung')).toBeInTheDocument();
    expect(screen.getByText('Brand: Tecno')).toBeInTheDocument();
    expect(
      screen.getByText('Price band: Best Smartphones Under ₦500,000')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Price band: Best Smartphones Under ₦1,000,000')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Compare link: View all smartphones comparisons')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Compare link: Alpha Phone vs Beta Phone')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Compare link: Apple vs Samsung')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `FAQ: ${CATEGORY_HUB_DEFAULTS.smartphones.faqItems[0].question}`
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Brand compare: Compare Apple vs Samsung')
    ).toHaveLength(2);
    expect(
      screen.queryByText('CommercialSupportLinks footer')
    ).not.toBeInTheDocument();
    expect(mockCategoryPageDeferredCompareLinks).toHaveBeenCalledWith(
      expect.objectContaining({ categorySlug: 'smartphones' })
    );
    expect(mockGetCachedProductSemanticInventory).not.toHaveBeenCalled();
  });

  it('prefers merchant-authored intro and faq over curated smartphone defaults', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      category: {
        ...categoryPageData.category,
        seo_heading: 'Shop curated smartphones for creators',
        seo_description: 'Merchant-authored smartphone intro copy.',
        seo_features: ['Merchant-backed warranty', 'Fast creator delivery'],
        seo_faq: [
          {
            question: 'Do these phones support eSIM?',
            answer: 'Selected models support eSIM.',
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(
      await screen.findByText(
        'Hub heading: Shop curated smartphones for creators'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('FAQ: Do these phones support eSIM?')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        `FAQ: ${CATEGORY_HUB_DEFAULTS.smartphones.faqItems[0].question}`
      )
    ).not.toBeInTheDocument();
    expect(getLastHubContent()?.trustFeatures).toEqual([
      'Merchant-backed warranty',
      'Fast creator delivery',
    ]);
    expect(
      screen.getByText('Best for: Best for Photography')
    ).toBeInTheDocument();
  });

  it('keeps collection intro and faq while omitting hub cards and compare support', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      isCollection: true,
      name: 'Refurbished Smartphones',
      seo: {
        heading: 'Certified refurbished smartphones in Lagos',
        description: 'Collection intro managed by the merchant.',
        features: ['Collection warranty', 'Tested before dispatch'],
        faqs: [
          {
            question: 'Are refurbished phones tested?',
            answer: 'Yes, before dispatch.',
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(
      await screen.findByText(
        'Hub heading: Certified refurbished smartphones in Lagos'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('FAQ: Are refurbished phones tested?')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Best for: Best for Photography')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Brand: Apple')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Price band: Best Smartphones Under ₦500,000')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Compare link: Apple vs Samsung')
    ).not.toBeInTheDocument();
    expect(getLastHubContent()?.trustFeatures).toEqual([
      'Collection warranty',
      'Tested before dispatch',
    ]);
    expect(
      screen.queryByText('CommercialSupportLinks footer')
    ).not.toBeInTheDocument();
  });

  it('renders non-priority category intro, features, and faq without hub cards', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      category: {
        ...categoryPageData.category,
        name: 'Headphones',
        slug: 'headphones',
        seo_heading: 'Buy headphones with clear fit guidance',
        seo_description: 'Merchant-authored copy for headphones.',
        seo_features: ['Noise-cancelling picks', 'Fast delivery'],
        seo_faq: [
          {
            question: 'Which headphones are best for calls?',
            answer: 'Focus on mic quality and comfort.',
          },
        ],
      },
      products: headphoneProducts,
      fallbackName: 'Headphones',
      fallbackDescription: 'Shop headphones',
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'headphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(
      await screen.findByText(
        'Hub heading: Buy headphones with clear fit guidance'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('FAQ: Which headphones are best for calls?')
    ).toBeInTheDocument();
    expect(getLastHubContent()?.trustFeatures).toEqual([
      'Noise-cancelling picks',
      'Fast delivery',
    ]);
    expect(
      screen.queryByText('Best for: Best for Photography')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Brand: Apple')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Price band: Best Smartphones Under ₦500,000')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Compare link: Apple vs Samsung')
    ).not.toBeInTheDocument();
  });

  it('uses the request-scoped storefront host for category hub links', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['host', 'preview-ogabassey.vercel.app']])
    );
    mockBuildRequestScopedStoreUrl.mockReturnValue(
      'https://preview-ogabassey.vercel.app'
    );

    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    const hubContent = getLastHubContent();

    expect(hubContent?.bestForCards[0]?.href).toContain(
      'https://preview-ogabassey.vercel.app/'
    );
    expect(hubContent?.brandCards[0]?.href).toContain(
      'https://preview-ogabassey.vercel.app/'
    );
    expect(hubContent?.priceBandCards[0]?.href).toContain(
      'https://preview-ogabassey.vercel.app/'
    );
    expect(hubContent?.comparisonLinks[0]?.href).toContain(
      'https://preview-ogabassey.vercel.app/'
    );
    expect(hubContent?.guideLinks[0]?.href).toContain(
      'https://preview-ogabassey.vercel.app/'
    );
  });

  it('uses hub intro copy for metadata title and descriptions', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toEqual({
      absolute: expect.stringContaining('Smartphones'),
    });
    const title = (metadata.title as { absolute: string }).absolute;
    expect(title).toContain('Ogabassey');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toContain('| Ogabassey | Ogabassey');
    expect(metadata.description).toBe(
      CATEGORY_HUB_DEFAULTS.smartphones.intro.description
    );
    expect(metadata.openGraph?.description).toBe(
      CATEGORY_HUB_DEFAULTS.smartphones.intro.description
    );
    expect(metadata.twitter?.description).toBe(
      CATEGORY_HUB_DEFAULTS.smartphones.intro.description
    );
  });

  it('uses page-specific category metadata for paginated listings', async () => {
    const firstPageMetadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });
    const secondPageMetadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(firstPageMetadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/smartphones'
    );
    expect(secondPageMetadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/smartphones?page=2'
    );
    expect(secondPageMetadata.title).toEqual({
      absolute: expect.stringContaining('Smartphones'),
    });
    const secondPageTitle = (secondPageMetadata.title as { absolute: string })
      .absolute;
    expect(secondPageTitle).toContain('Page 2');
    expect(secondPageTitle).toContain('Ogabassey');
    expect(secondPageTitle.length).toBeLessThanOrEqual(60);
    expect(secondPageTitle).not.toContain('| Ogabassey | Ogabassey');
    expect(secondPageMetadata.description).toContain('Page 2 of');
    expect(secondPageMetadata.openGraph?.description).toContain('Page 2 of');
    expect(secondPageMetadata.twitter?.description).toContain('Page 2 of');
    expect(secondPageMetadata.openGraph?.url).toBe(
      'https://test-store.usebaci.com/smartphones?page=2'
    );
    expect(secondPageMetadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/product-21.png',
        alt: 'Smartphones',
      },
    ]);
    expect(secondPageMetadata.twitter?.images).toEqual([
      'https://cdn.example.com/product-21.png',
    ]);
  });

  it('returns category not-found metadata for a repeatedly percent-encoded slug before any cached lookup runs', async () => {
    let overEncodedSlug = 'x y';
    for (let index = 0; index < 10; index += 1) {
      overEncodedSlug = encodeURIComponent(overEncodedSlug);
    }

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: overEncodedSlug,
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBe('Category not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(getCachedMerchant).not.toHaveBeenCalled();
    expect(getCachedMerchantByDomain).not.toHaveBeenCalled();
    expect(getCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('returns category not-found metadata for an over-long category slug before any cached lookup runs', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'a'.repeat(4000),
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBe('Category not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(getCachedMerchant).not.toHaveBeenCalled();
    expect(getCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('still resolves metadata for a valid short slug through the cached lookups', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).not.toBe('Category not found');
    expect(getCachedMerchant).toHaveBeenCalledWith('test-store');
    expect(getCachedCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'test-store',
      0,
      20
    );
  });

  it('returns noindex soft-404 metadata for inactive category slugs', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: null,
      products: [],
      fallbackName: 'Inactive Category',
      fallbackDescription: 'Inactive category',
      isInactiveCategory: true,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'inactive-category',
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBe('Category not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(metadata).toMatchObject({
      openGraph: {
        description: 'This category is unavailable or has moved.',
        title: 'Category not found',
      },
      twitter: {
        card: 'summary',
        description: 'This category is unavailable or has moved.',
        title: 'Category not found',
      },
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns noindex soft-404 metadata for unknown category slugs with no products (doorway stopgap)', async () => {
    // Unknown/typo slug: not a collection, no resolved category row, and the
    // legacy fuzzy fallback matched nothing — previously rendered index,follow
    // (the doorway trap). isInactiveCategory is FALSE here (distinct from the
    // inactive-category case above), so only the doorway guard catches it.
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: null,
      products: [],
      fallbackName: 'Totally Made Up',
      fallbackDescription: 'Totally made up',
      isInactiveCategory: false,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'totally-made-up-slug',
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBe('Category not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(metadata).toMatchObject({
      openGraph: {
        description: 'This category is unavailable or has moved.',
        title: 'Category not found',
      },
      twitter: {
        card: 'summary',
        description: 'This category is unavailable or has moved.',
        title: 'Category not found',
      },
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('does not notFound a real category that has products', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: { id: 'cat-1', name: 'Smartphones', slug: 'smartphones' },
      products: [{ id: 'p1', name: 'Phone', slug: 'phone', price: 1000 }],
      fallbackName: 'Smartphones',
      fallbackDescription: 'Smartphones',
      isInactiveCategory: false,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('does not notFound an empty result caused by a transient products-query error (fail open)', async () => {
    // Same empty shape as an unknown slug, but the products fallback query
    // FAILED — must not be mistaken for a genuine doorway and noindex'd.
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: null,
      products: [],
      fallbackName: 'Maybe Real',
      fallbackDescription: 'Maybe real',
      isInactiveCategory: false,
      productIdsQueryFailed: true,
      productsQueryFailed: true,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'maybe-real' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('does not notFound an empty result caused by a transient category-lookup error (fail open)', async () => {
    // The category `.single()` lookup itself failed transiently (not a normal
    // "no rows") — we cannot prove the slug is a doorway, so fail open.
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: null,
      products: [],
      fallbackName: 'Maybe Real',
      fallbackDescription: 'Maybe real',
      isInactiveCategory: false,
      categoryQueryFailed: true,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'maybe-real' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.title).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns soft-not-found metadata for known out-of-range pages even when category lookup fails open', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      categoryQueryFailed: true,
      productIdsQueryFailed: false,
      products: smartphoneHubProducts.slice(0, 20),
      productSlots: smartphoneHubProducts.slice(0, 20),
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(getCachedCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'test-store',
      20,
      20
    );
    expect(metadata.title).toBe('Category page not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('drops focused storefront filters from category canonical metadata until listing results are filtered', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ brand: 'Apple', page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/smartphones?page=2'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://test-store.usebaci.com/smartphones?page=2'
    );
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('preserves the page marker when long category titles are truncated', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      category: {
        ...categoryPageData.category,
        seo_heading:
          'Shop ultra-premium smartphones with exceptional cameras, long battery life, and creator-grade storage in Lagos',
      },
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.title).toEqual({
      absolute: expect.stringContaining('Page 2'),
    });
    const title = (metadata.title as { absolute: string }).absolute;
    expect(title).toContain('Ogabassey');
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('returns noindex soft-404 metadata for out-of-range metadata pages', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({ page: '3' }),
    });

    expect(metadata.title).toBe('Category page not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(metadata).toMatchObject({
      openGraph: {
        description: 'This category page is unavailable or has moved.',
        title: 'Category page not found',
      },
      twitter: {
        card: 'summary',
        description: 'This category page is unavailable or has moved.',
        title: 'Category page not found',
      },
    });
  });

  it('fails open but noindexes out-of-range metadata pages when product ID pagination is unknown', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: { id: 'cat-1', name: 'Smartphones', slug: 'smartphones' },
      products: [],
      fallbackName: 'Smartphones',
      fallbackDescription: 'Smartphones',
      isInactiveCategory: false,
      productIdsQueryFailed: true,
      productsQueryFailed: true,
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'test-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({ page: '3' }),
    });

    expect(metadata.title).not.toBe('Category page not found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).not.toBeNull();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('uses hub faq items for FAQ JSON-LD', async () => {
    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(mockGenerateFAQSchema).toHaveBeenCalledWith(
      CATEGORY_HUB_DEFAULTS.smartphones.faqItems
    );
  });

  it('passes normalized category products into collection schema generation', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      products: [
        {
          ...smartphoneHubProducts[0],
          image: '',
          images: ['https://cdn.example.com/normalized-phone.png'],
          category: null,
          category_slug: 'smartphones',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({
            image: 'https://cdn.example.com/normalized-phone.png',
            category_slug: 'smartphones',
            price: 420000,
          }),
        ],
      })
    );
  });

  it('preserves refurbished condition in category page products', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      products: [
        {
          ...smartphoneHubProducts[0],
          condition: 'refurbished',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const ui = await actualCategoryPageContentModule.CategoryPageContent({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(getLastCategoryPageProps()?.products?.[0]?.condition).toBe(
      'refurbished'
    );
  });

  it('renders stable noindex soft-not-found content for out-of-range category pages', async () => {
    render(
      await actualCategoryPageContentModule.CategoryPageContent({
        params: Promise.resolve({
          slug: 'test-store',
          category: 'smartphones',
        }),
        searchParams: Promise.resolve({ page: '3' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Category page not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue shopping' })
    ).toHaveAttribute('href', '/test-store');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('falls back to the normalized placeholder image when the category page has no product media', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      products: [
        {
          ...smartphoneHubProducts[0],
          image: '',
          images: [],
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getCachedCategoryPageData>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store', category: 'smartphones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        url: `https://test-store.usebaci.com${NORMALIZED_PLACEHOLDER_IMAGE}`,
        alt: 'Smartphones',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      `https://test-store.usebaci.com${NORMALIZED_PLACEHOLDER_IMAGE}`,
    ]);
  });
});
