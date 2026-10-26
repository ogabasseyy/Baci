import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Focused integration test for the PdpRepairDeviceLink wiring in
// ProductPageBelowFold (the deferred PDP enrichment that streams below the
// critical shell). The link component itself has full unit coverage in
// components/storefront/repairs/PdpRepairDeviceLink.test.tsx — here we only
// prove the below-fold segment awaits it, passes the right props, and that the
// real feature gate + data-layer lookup decide whether the link is rendered.
//
// ProductPageBelowFold is pre-awaited (not rendered as JSX) because React's
// client renderer used by @testing-library/react cannot invoke async
// components — only the RSC server renderer can.
//
// Everything the below-fold segment touches except PdpRepairDeviceLink (and
// its pure helpers: repairs-feature, routes) is stubbed to keep this light.

const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn();
const mockLoadCategoryScopedSemanticInventorySafely = vi.fn(() =>
  Promise.resolve({ isCollection: false, products: [] as unknown[] })
);
const mockLoadPdpBrandHubEligibilityInventorySafely = vi.fn();
const mockBuildProductSemanticModel = vi.fn((_input: unknown) => ({
  supportLinks: [],
  guideLinks: [],
  alternatives: null,
  sameBrand: null,
  samePrice: null,
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null, has: () => false }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/product-semantic-sections',
  () => ({
    ProductSemanticSections: () => null,
  })
);

vi.mock('./product-detail-client', () => ({
  default: () => <div>product detail client</div>,
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedProductRatingStats: vi.fn(() => Promise.resolve(null)),
  getCachedProductReviews: vi.fn(() => Promise.resolve([])),
  getPublicSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({
    loadCategoryScopedSemanticInventorySafely: () =>
      mockLoadCategoryScopedSemanticInventorySafely(),
  })
);

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: () => Promise.resolve([]),
}));

vi.mock(
  '@/lib/storefront-product/load-pdp-brand-hub-eligibility-inventory-safely',
  () => ({
    loadPdpBrandHubEligibilityInventorySafely: (...args: unknown[]) =>
      mockLoadPdpBrandHubEligibilityInventorySafely(...args),
  })
);

vi.mock('@/lib/storefront-product/build-product-context-paragraphs', () => ({
  buildProductContextParagraphs: () => [],
}));

vi.mock('@/lib/storefront-product/build-product-semantic-model', () => ({
  buildProductSemanticModel: (input: unknown) =>
    mockBuildProductSemanticModel(input),
}));

vi.mock('@/lib/storefront-product-price-seo', () => ({
  buildProductPriceSeoCopy: () => ({
    priceText: '₦495,000',
    title: '',
    description: '',
  }),
}));

vi.mock('@/lib/storefront-path-prefix', () => ({
  getStorefrontPathPrefix: () => '/teststore',
}));

const { ProductPageBelowFold } = await import('./product-page-runtime');

function buildRepairDeviceQuery(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: () => mockMaybeSingle(result),
  };
  return chain;
}

const product = {
  id: 'product-1',
  name: 'iPhone 13 Pro Max',
  slug: 'iphone-13-pro-max',
  brand: 'Apple',
  condition: 'new',
  price: 495000,
  stock: 3,
  category: 'Phones',
  category_slug: 'phones',
  categories: { name: 'Phones', slug: 'phones' },
  product_key_specs: null,
  faqs: undefined,
} as never;

const enabledMerchant = {
  id: 'merchant-1',
  business_name: 'TestStore',
  slug: 'teststore',
  business_type: 'electronics',
  feature_settings: { repairs_catalog_enabled: true },
  payout_currency: 'NGN',
  country: 'NG',
  logo_url: null,
};

const BASE_URL = 'https://teststore.usebaci.com';

async function renderBelowFold(merchant: typeof enabledMerchant) {
  return render(
    await ProductPageBelowFold({
      baseUrl: BASE_URL,
      categoryName: 'Phones',
      categorySlug: 'phones',
      currency: 'NGN',
      merchant: merchant as never,
      product,
      productUrl: `${BASE_URL}/products/iphone-13-pro-max`,
      slug: 'teststore',
    })
  );
}

describe('ProductPageBelowFold — repair device link integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValue([]);
    mockMaybeSingle.mockImplementation((result) => Promise.resolve(result));
  });

  it('renders the "Repair this device" link when a linked device exists and the feature is on', async () => {
    mockFrom.mockReturnValue(
      buildRepairDeviceQuery({
        data: { slug: 'apple-iphone-13-pro-max' },
        error: null,
      })
    );

    await renderBelowFold(enabledMerchant);

    expect(
      screen.getByRole('link', { name: /repair this device/i })
    ).toHaveAttribute('href', '/teststore/repairs/apple-iphone-13-pro-max');
  });

  it('does not render the link when no device links to this product', async () => {
    mockFrom.mockReturnValue(
      buildRepairDeviceQuery({ data: null, error: null })
    );

    await renderBelowFold(enabledMerchant);

    expect(
      screen.queryByRole('link', { name: /repair this device/i })
    ).not.toBeInTheDocument();
  });

  it('does not query the catalogue or render the link when the repairs feature is off', async () => {
    await renderBelowFold({
      ...enabledMerchant,
      feature_settings: { repairs_catalog_enabled: false },
    });

    expect(mockFrom).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('link', { name: /repair this device/i })
    ).not.toBeInTheDocument();
  });

  it('forwards dedicated hubEligibilityInventory (and NOT category_slug-rewritten inventoryCandidates) into buildProductSemanticModel', async () => {
    const mockHubInventory = [
      {
        slug: 'apple-iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 450000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'phones',
      },
    ];
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValueOnce(
      mockHubInventory
    );

    await renderBelowFold(enabledMerchant);

    expect(mockLoadPdpBrandHubEligibilityInventorySafely).toHaveBeenCalledWith({
      categorySlug: 'phones',
      merchantId: 'merchant-1',
      productBrand: 'Apple',
    });

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        hubEligibilityInventory: mockHubInventory,
      })
    );

    const callArgs = mockBuildProductSemanticModel.mock.calls[0]?.[0] as {
      hubEligibilityInventory?: unknown[];
      inventory?: unknown[];
    };
    expect(callArgs.hubEligibilityInventory).toBe(mockHubInventory);
    expect(callArgs.hubEligibilityInventory).not.toBe(callArgs.inventory);
  });

  it('still renders below-the-fold content when hubEligibilityInventory is empty', async () => {
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValueOnce([]);
    mockFrom.mockReturnValue(
      buildRepairDeviceQuery({
        data: { slug: 'apple-iphone-13-pro-max' },
        error: null,
      })
    );

    await renderBelowFold(enabledMerchant);

    expect(
      screen.getByRole('link', { name: /repair this device/i })
    ).toBeInTheDocument();
    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        hubEligibilityInventory: [],
      })
    );
  });

  it('passes empty hubEligibilityInventory when scopedInventory is a collection', async () => {
    mockLoadCategoryScopedSemanticInventorySafely.mockResolvedValueOnce({
      isCollection: true,
      products: [
        {
          slug: 'child-item',
          name: 'Child Item',
          brand: 'Apple',
          price: 400000,
          category_slug: 'sub-phones',
        },
      ],
    });
    mockLoadPdpBrandHubEligibilityInventorySafely.mockResolvedValueOnce([
      {
        slug: 'apple-iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 450000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'phones',
      },
    ]);

    await renderBelowFold(enabledMerchant);

    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        inventory: [],
        hubEligibilityInventory: [],
      })
    );
  });
});
