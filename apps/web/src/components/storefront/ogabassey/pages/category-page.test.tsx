import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalMatchMedia = window.matchMedia;
const mockAddToCart = vi.fn();
const mockRouterPush = vi.hoisted(() => vi.fn());

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(min-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => <a {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ slug: 'test', category: 'electronics' })),
  useRouter: vi.fn(() => ({ push: mockRouterPush, back: vi.fn() })),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    items: [],
    addToCart: mockAddToCart,
    totalItems: 0,
  })),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { id: 'm-1', slug: 'test', business_name: 'Test Store' },
    basePath: '/test-store',
  })),
}));
vi.mock('@/lib/routes', () => ({ asRoute: vi.fn((p: string) => p) }));
vi.mock('../components/AdUnit', () => ({ AdUnit: () => null }));
vi.mock('../components/CategoryRecentCarousel', () => ({
  CategoryRecentCarousel: () => (
    <section aria-label="Recently added products" />
  ),
}));
// Capture the handler the page wires into the filter sidebar so a test can
// invoke a price change vs a checkbox change directly.
const filterHarness = vi.hoisted(() => ({
  onFilterChange: null as
    | ((section: string, value: string | number) => void | Promise<void>)
    | null,
}));
vi.mock('../components/CategoryFiltersSidebar', () => ({
  CategoryFiltersSidebar: ({
    onFilterChange,
  }: {
    onFilterChange?: (section: string, value: string | number) => void;
  }) => {
    filterHarness.onFilterChange = onFilterChange ?? null;
    return null;
  },
}));

// Spy on the INP yield so we can assert price edits commit synchronously
// (no yield) while checkbox/grid edits still yield.
const yieldSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/yield-to-scheduler', () => ({ yieldToScheduler: yieldSpy }));
vi.mock('../components/ProductCard', () => ({
  ProductCard: ({
    product,
    isAdded,
    onAddToCart,
  }: {
    product: { name: string };
    isAdded?: boolean;
    onAddToCart?: (event: React.MouseEvent, product: unknown) => void;
  }) => (
    <article aria-label={product.name}>
      <button type="button" onClick={(event) => onAddToCart?.(event, product)}>
        Add {product.name}
      </button>
      <span>{isAdded ? 'Added' : 'Idle'}</span>
    </article>
  ),
}));

import { useParams } from 'next/navigation';
import { CategoryPage } from './category-page';

describe('CategoryPage', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    window.history.replaceState({}, '', '/test-store/electronics');
    mockAddToCart.mockReset();
    mockRouterPush.mockReset();
    yieldSpy.mockClear();
    filterHarness.onFilterChange = null;
    vi.mocked(useParams).mockReturnValue({
      slug: 'test',
      category: 'electronics',
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const PRODUCT_WITH_IMAGE = {
    id: '1',
    name: 'Newest Phone',
    slug: 'newest-phone',
    description: 'A newly added phone',
    price: '₦100',
    rawPrice: 100,
    image: 'https://cdn.ogabassey.com/newest.avif',
    condition: 'New' as const,
  };

  it('commits price-filter edits synchronously so typed characters are not dropped (PR #3021 regression)', async () => {
    mockMatchMedia(true);
    render(<CategoryPage products={[PRODUCT_WITH_IMAGE]} />);

    expect(filterHarness.onFilterChange).toBeTypeOf('function');

    // A price edit must NOT cross a scheduler.yield() task boundary — doing so
    // let React restore the stale controlled value between keystrokes.
    await act(async () => {
      await filterHarness.onFilterChange?.('minPrice', 500);
    });
    expect(yieldSpy).not.toHaveBeenCalled();

    await act(async () => {
      await filterHarness.onFilterChange?.('maxPrice', 900);
    });
    expect(yieldSpy).not.toHaveBeenCalled();

    // A checkbox edit re-renders the whole grid and SHOULD still yield first
    // (the INP presentation-delay win this handler was written for).
    await act(async () => {
      await filterHarness.onFilterChange?.('brand', 'apple');
    });
    expect(yieldSpy).toHaveBeenCalledTimes(1);
  });

  it('routes graphics changes through the server when the category is pre-paginated', async () => {
    mockMatchMedia(true);
    window.history.replaceState(
      {},
      '',
      '/test-store/gaming-laptops?page=2'
    );

    render(
      <CategoryPage
        graphicsOptions={['Integrated Graphics', 'NVIDIA RTX 4070']}
        products={[PRODUCT_WITH_IMAGE]}
        productsArePrePaginated={true}
        totalProductCount={40}
      />
    );

    await act(async () => {
      await filterHarness.onFilterChange?.('graphics', 'NVIDIA RTX 4070');
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/test-store/gaming-laptops?graphics=NVIDIA+RTX+4070'
    );
    expect(yieldSpy).not.toHaveBeenCalled();
  });

  it('renders the recently-added product carousel in place of the promo banner', () => {
    mockMatchMedia(true);

    render(<CategoryPage products={[PRODUCT_WITH_IMAGE]} />);

    expect(screen.getByRole('region', { name: /recently added products/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /category banner carousel/i })
    ).not.toBeInTheDocument();
  });

  it.each(['best-sellers', 'on-sale', 'featured'])(
    'hides the recent carousel on the sorted collection route "%s" (not created_at ordered)',
    (collection) => {
      mockMatchMedia(true);
      vi.mocked(useParams).mockReturnValue({
        slug: 'test',
        category: collection,
      });

      render(<CategoryPage products={[PRODUCT_WITH_IMAGE]} />);

      expect(
        screen.queryByRole('region', { name: /recently added products/i })
      ).not.toBeInTheDocument();
    }
  );

  it('hides the recent carousel on later pre-paginated pages (page slice is not the newest items)', () => {
    mockMatchMedia(true);

    render(
      <CategoryPage
        currentPage={2}
        products={[]}
        productsArePrePaginated={true}
        totalProductCount={25}
      />
    );

    expect(
      screen.queryByRole('region', { name: /recently added products/i })
    ).not.toBeInTheDocument();
  });

  it('still shows the recent carousel on the first pre-paginated page', () => {
    mockMatchMedia(true);

    render(
      <CategoryPage
        currentPage={1}
        products={[PRODUCT_WITH_IMAGE]}
        productsArePrePaginated={true}
        totalProductCount={25}
      />
    );

    expect(screen.getByRole('region', { name: /recently added products/i })).toBeInTheDocument();
  });

  it('renders crawlable pagination links for category results', () => {
    mockMatchMedia(true);

    const products = Array.from({ length: 25 }, (_, index) => ({
      id: String(index + 1),
      name: `Product ${index + 1}`,
      slug: `product-${index + 1}`,
      description: `Description ${index + 1}`,
      price: `₦${index + 1}`,
      rawPrice: index + 1,
      image: '',
      condition: 'New' as const,
    }));

    render(<CategoryPage currentPage={2} products={products} />);

    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(
      screen.getByText('Showing 21-25 of 25 products')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /load more products/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/test-store/electronics'
    );
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/test-store/electronics'
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/test-store/electronics?page=2'
    );
    expect(
      screen.getByRole('link', { name: 'Electronics page 2' })
    ).toHaveAttribute('href', '/test-store/electronics?page=2');
  });

  it('uses explicit total product count when server sends only the current page slice', () => {
    mockMatchMedia(true);

    const products = [
      {
        id: '25',
        name: 'Recovered Product',
        slug: 'recovered-product',
        description: 'Recovered detail row',
        price: '₦25',
        rawPrice: 25,
        image: '',
        condition: 'New' as const,
      },
    ];
    const prePaginatedProps = {
      currentPage: 2,
      products,
      productsArePrePaginated: true,
      totalProductCount: 25,
    } as unknown as React.ComponentProps<typeof CategoryPage>;

    render(<CategoryPage {...prePaginatedProps} />);

    expect(screen.getByRole('article', { name: 'Recovered Product' }))
      .toBeInTheDocument();
    expect(
      screen.getByText('Showing 21-21 of 25 products')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /filters/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/test-store/electronics'
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/test-store/electronics?page=2'
    );
  });

  it('keeps pagination reachable when a pre-paginated detail slice is empty', () => {
    mockMatchMedia(true);

    render(
      <CategoryPage
        currentPage={2}
        products={[]}
        productsArePrePaginated={true}
        totalProductCount={25}
      />
    );

    expect(screen.queryByText('No products found')).not.toBeInTheDocument();
    expect(
      screen.getByText('Products on this page are temporarily unavailable.')
    ).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/test-store/electronics'
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/test-store/electronics?page=2'
    );
  });

  it('falls back to the default storefront page size when itemsPerPage is invalid', () => {
    mockMatchMedia(true);

    const products = Array.from({ length: 25 }, (_, index) => ({
      id: String(index + 1),
      name: `Product ${index + 1}`,
      slug: `product-${index + 1}`,
      description: `Description ${index + 1}`,
      price: `₦${index + 1}`,
      rawPrice: index + 1,
      image: '',
      condition: 'New' as const,
    }));

    render(
      <CategoryPage currentPage={2} itemsPerPage={0} products={products} />
    );

    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(
      screen.getByText('Showing 21-25 of 25 products')
    ).toBeInTheDocument();
  });

  it('renders the server-composed hub sections slot below the product grid', () => {
    mockMatchMedia(true);

    render(
      <CategoryPage
        hubSections={
          <section aria-label="Category hub sections">
            Server-rendered hub content
          </section>
        }
        products={[]}
      />
    );

    // The slot is a pre-rendered server node (CategoryHubSections) injected by
    // the RSC boundary; the client CategoryPage only places it, so SafeHtml /
    // sanitize-html never enters this component's bundle.
    expect(
      screen.getByRole('region', { name: 'Category hub sections' })
    ).toHaveTextContent('Server-rendered hub content');
  });

  it('omits the hub sections region when no slot is provided', () => {
    mockMatchMedia(true);

    render(<CategoryPage products={[]} />);

    expect(
      screen.queryByRole('region', { name: 'Category hub sections' })
    ).not.toBeInTheDocument();
  });

  it('passes a numeric cart price when adding a category product', () => {
    mockMatchMedia(true);

    render(
      <CategoryPage
        products={[
          {
            id: '1',
            name: 'Galaxy S',
            slug: 'galaxy-s',
            description: 'Flagship phone',
            price: '₦123,000',
            rawPrice: 123000,
            image: '/galaxy-s.jpg',
            condition: 'New',
            brand: 'Samsung',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Galaxy S' }));

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        name: 'Galaxy S',
        price: 123000,
      }),
      1
    );
  });

  it('clears the transient added state for string product ids after the timeout', () => {
    vi.useFakeTimers();
    mockMatchMedia(true);

    render(
      <CategoryPage
        products={[
          {
            id: 'uuid-1',
            name: 'Galaxy S',
            slug: 'galaxy-s',
            description: 'Flagship phone',
            price: '₦123,000',
            rawPrice: 123000,
            image: '/galaxy-s.jpg',
            condition: 'New',
            brand: 'Samsung',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Galaxy S' }));
    expect(screen.getByText('Added')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Idle')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
