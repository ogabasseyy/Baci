import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategories,
  getRequestScopedMerchant,
} from '@/lib/cached-data';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type CategoryPageProps = {
  params: Promise<{ category: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const { mockCategoryPageRoute, mockComparePageContent } = vi.hoisted(() => ({
  mockCategoryPageRoute: vi.fn((_props: CategoryPageProps) => (
    <div>Compare category content</div>
  )),
  mockComparePageContent: vi.fn((_props: unknown) => (
    <div>Compare index content</div>
  )),
}));

const mockConnection = vi.hoisted(() => vi.fn());
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
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

vi.mock('../[category]/page', () => ({
  default: (props: CategoryPageProps) => mockCategoryPageRoute(props),
  generateMetadata: vi.fn(),
}));

vi.mock('./compare-page-content', () => ({
  ComparePageContent: (props: unknown) => mockComparePageContent(props),
}));

type RequestScopedMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;
type CachedCategories = Awaited<ReturnType<typeof getCachedCategories>>;

const merchant = {
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
  custom_domain: 'ogabassey.com',
  business_address: '',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'ogabassey',
  plan_tier: 'free',
  premium_features: {},
  country: 'NG',
} satisfies RequestScopedMerchant;

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

const {
  CompareIndexRuntime,
  default: CompareIndexPage,
  generateStaticParams,
} = await import('./page');

describe('compare index page runtime', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getCachedCategories).mockReset();
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(merchant);
    vi.mocked(getCachedCategories).mockResolvedValue(categories);
    mockComparePageContent.mockReset();
    mockComparePageContent.mockImplementation(() => (
      <div>Compare index content</div>
    ));
    mockCategoryPageRoute.mockReset();
    mockCategoryPageRoute.mockImplementation(() => (
      <div>Compare category content</div>
    ));
    mockConnection.mockReset();
    mockConnection.mockResolvedValue(undefined);
    mockNotFound.mockClear();
  });

  it('prerenders both OgaBassey host identifiers so the hub intro can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('paints the compare hub heading while compare content is pending', () => {
    mockComparePageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Keep content suspended behind the compare-hub LCP intro.
      });
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>
        <CompareIndexPage params={Promise.resolve({ slug: 'ogabassey' })} />
      </Suspense>
    );

    expect(
      screen.getByRole('heading', { name: 'Compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' })
    ).toHaveTextContent('Home / Compare products');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '.'
    );
    const main = screen.getByRole('main');
    expect(main).toContainElement(
      screen.getByRole('navigation', { name: 'Breadcrumb' })
    );
    expect(main).toContainElement(
      screen.getByRole('heading', { name: 'Compare products' })
    );
    expect(
      screen.queryByRole('status', { name: 'Loading product listing' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Compare index content')).not.toBeInTheDocument();
    expect(document.querySelector('[data-compare-hub-chrome]')).not.toBeNull();
  });

  it('keeps Home on the storefront origin for slug-prefixed compare URLs', () => {
    expect(new URL('.', 'https://baci.app/ogabassey/compare').pathname).toBe(
      '/ogabassey/'
    );
    expect(new URL('..', 'https://baci.app/ogabassey/compare').pathname).toBe(
      '/'
    );
  });

  it('marks a real compare category so first-paint CSS can hide the hub shell', async () => {
    vi.mocked(getCachedCategories).mockResolvedValue([
      {
        ...categories[0],
        name: 'Compare',
        slug: 'compare',
      },
    ]);

    render(
      await CompareIndexRuntime({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Compare category content')).toBeInTheDocument();
    expect(
      document.querySelector('[data-compare-category-page]')
    ).not.toBeNull();
    expect(
      mockCategoryPageRoute.mock.calls[0]?.[0].titleHeading
    ).toBeUndefined();
  });

  it('does not mark the hub as a category page when compare is not a category', async () => {
    render(
      await CompareIndexRuntime({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Compare index content')).toBeInTheDocument();
    expect(document.querySelector('[data-compare-category-page]')).toBeNull();
  });
});
