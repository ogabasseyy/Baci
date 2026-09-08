import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategories,
  getCachedCategoryPageData,
  getRequestScopedMerchant,
} from '@/lib/cached-data';

const mockHeaders = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mocks = vi.hoisted(() => ({
  JsonLd: vi.fn(() => null),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => <a {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: mocks.JsonLd,
}));

vi.mock('@/lib/cached-data', () => {
  const getCachedCategories = vi.fn();

  return {
    getCachedCategories,
    getStorefrontCategories: async (...args: unknown[]) => {
      try {
        return {
          categories: await getCachedCategories(...args),
          queryFailed: false,
        };
      } catch {
        return { categories: [], queryFailed: true };
      }
    },
    getCachedCategoryPageData: vi.fn(),
    getRequestScopedMerchant: vi.fn(),
  };
});

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

type RequestScopedMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;
type CachedCategories = Awaited<ReturnType<typeof getCachedCategories>>;
type CategoryPageData = Awaited<ReturnType<typeof getCachedCategoryPageData>>;

function makeMerchant(
  overrides: Partial<RequestScopedMerchant> = {}
): RequestScopedMerchant {
  return {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    site_title: 'Ogabassey',
    site_tagline: 'Devices and repairs',
    site_description: 'Shop devices and repairs.',
    business_type: 'electronics',
    logo_url: '',
    phone: '',
    email: 'support@ogabassey.com',
    slug: 'ogabassey',
    business_address: '',
    payout_currency: 'NGN',
    is_published: true,
    template_id: 'ogabassey',
    plan_tier: 'free',
    premium_features: {},
    country: 'NG',
    ...overrides,
  };
}

const merchant = makeMerchant({ custom_domain: 'ogabassey.com' });

const laptopProducts = [
  {
    id: 'macbook-air-15',
    name: '15" MacBook Air M4 (2025)',
    slug: 'macbook-air-15-inch-m4-2025',
    price: 2_000_000,
    category: 'Laptops',
    brand: 'Apple',
    condition: 'new',
    product_key_specs: {
      chipset: 'Apple M4',
      ram_gb: 16,
      screen_size_inches: 15,
      storage_gb: 512,
    },
  },
  {
    id: 'dell-xps-13',
    name: 'Dell XPS 13 9350',
    slug: 'dell-xps-13-9350',
    price: 900_000,
    category: 'Laptops',
    brand: 'Dell',
    condition: 'new',
    product_key_specs: {
      chipset: 'Intel Core Ultra 7',
      ram_gb: 16,
      screen_size_inches: 13,
      storage_gb: 1024,
    },
  },
];
const categories = [
  {
    id: 'category-1',
    name: 'Laptops',
    slug: 'laptops',
    description: null,
    image_url: null,
    is_active: true,
    parent_id: null,
  },
] satisfies CachedCategories;
const categoryPageData = {
  isCollection: false,
  category: null,
  fallbackDescription: 'Shop laptops.',
  fallbackName: 'Laptops',
  isInactiveCategory: false,
  products: laptopProducts,
} satisfies CategoryPageData;

const { ComparePageContent } = await import('./compare-page-content');

describe('ComparePageContent', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getCachedCategories).mockReset();
    vi.mocked(getCachedCategoryPageData).mockReset();
    mockHeaders.mockReset();
    mockNotFound.mockClear();
    mocks.JsonLd.mockClear();

    vi.mocked(getRequestScopedMerchant).mockResolvedValue(merchant);
    vi.mocked(getCachedCategories).mockResolvedValue(categories);
    vi.mocked(getCachedCategoryPageData).mockResolvedValue(categoryPageData);
    mockHeaders.mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
  });

  it('renders grouped canonical compare links without platform prefixes on a custom domain', async () => {
    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Laptops' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Compare Dell XPS 13 9350 with 15" MacBook Air M4 (2025)',
      })
    ).toHaveAttribute(
      'href',
      '/laptops/compare/dell-xps-13-9350-vs-macbook-air-15-inch-m4-2025'
    );
    expect(screen.getByRole('link', { name: 'Shop Laptops' })).toHaveAttribute(
      'href',
      '/laptops'
    );
  });

  it('prefixes compare links on path-scoped platform storefronts', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(makeMerchant());
    mockHeaders.mockResolvedValueOnce(new Headers());

    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('link', {
        name: 'Compare Dell XPS 13 9350 with 15" MacBook Air M4 (2025)',
      })
    ).toHaveAttribute(
      'href',
      '/ogabassey/laptops/compare/dell-xps-13-9350-vs-macbook-air-15-inch-m4-2025'
    );
    expect(screen.getByRole('link', { name: 'Shop Laptops' })).toHaveAttribute(
      'href',
      '/ogabassey/laptops'
    );
  });

  it('uses the resolved merchant name in the compare index description', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(
      makeMerchant({
        business_name: 'Demo Devices',
        custom_domain: 'demo.example',
      })
    );

    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'demo-devices' }),
      })
    );

    expect(
      screen.getByText(/Browse Demo Devices product comparison pages/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/phones, laptops, audio/)
    ).not.toBeInTheDocument();
  });

  it('renders breadcrumb JSON-LD without an empty CollectionPage item list', async () => {
    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(mocks.JsonLd).toHaveBeenCalledTimes(1);
    expect(mocks.JsonLd).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          '@type': 'BreadcrumbList',
        }),
      }),
      undefined
    );
  });

  it('renders an empty state when no category can publish compare links', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      isCollection: false,
      category: null,
      fallbackDescription: 'Shop laptops.',
      fallbackName: 'Laptops',
      isInactiveCategory: false,
      products: [],
    } satisfies CategoryPageData);

    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'No product comparisons available' })
    ).toBeInTheDocument();
  });

  it('renders the compare shell when optional category navigation is unavailable', async () => {
    vi.mocked(getCachedCategories).mockRejectedValueOnce(
      new Error('category timeout')
    );

    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Product comparisons temporarily unavailable',
      })
    ).toBeInTheDocument();
  });

  it('calls notFound for invalid storefront identifiers', async () => {
    await expect(
      ComparePageContent({
        params: Promise.resolve({ slug: 'images' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('calls notFound when the storefront merchant is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);

    await expect(
      ComparePageContent({
        params: Promise.resolve({ slug: 'missing-storefront' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('caps visible compare hub product scans instead of dumping the discovery graph into HTML', async () => {
    const { COMPARE_HUB_PAGE_PRODUCTS_PER_CATEGORY_LIMIT } = await import(
      './compare-index-discovery'
    );

    render(
      await ComparePageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(getCachedCategoryPageData).toHaveBeenCalledWith(
      merchant.id,
      'laptops',
      merchant.slug,
      0,
      COMPARE_HUB_PAGE_PRODUCTS_PER_CATEGORY_LIMIT
    );
    expect(
      screen.getAllByRole('link', { name: /Compare / }).length
    ).toBeLessThanOrEqual(4);
  });
});
