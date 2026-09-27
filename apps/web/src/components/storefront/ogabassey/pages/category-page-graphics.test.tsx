import { act, render, screen } from '@testing-library/react';
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

describe('CategoryPage graphics filtering', () => {
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

  it('routes graphics changes through the server when the category is pre-paginated', async () => {
    mockMatchMedia(true);
    vi.mocked(useParams).mockReturnValue({
      slug: 'test',
      category: 'gaming-laptops',
    });
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

  it('keeps graphics local with other client facets when the full set is loaded', async () => {
    mockMatchMedia(true);
    vi.mocked(useParams).mockReturnValue({
      slug: 'test',
      category: 'gaming-laptops',
    });
    window.history.replaceState({}, '', '/test-store/gaming-laptops');

    const products = [
      {
        ...PRODUCT_WITH_IMAGE,
        id: 'rtx-apple',
        name: 'RTX Apple Laptop',
        brand: 'Apple',
        graphics: 'NVIDIA RTX 4070',
      },
      {
        ...PRODUCT_WITH_IMAGE,
        id: 'integrated-apple',
        name: 'Integrated Apple Laptop',
        brand: 'Apple',
        graphics: 'Integrated Graphics',
      },
      {
        ...PRODUCT_WITH_IMAGE,
        id: 'rtx-dell',
        name: 'RTX Dell Laptop',
        brand: 'Dell',
        graphics: 'NVIDIA RTX 4070',
      },
    ];

    render(
      <CategoryPage
        graphicsOptions={['Integrated Graphics', 'NVIDIA RTX 4070']}
        products={products}
      />
    );

    await act(async () => {
      await filterHarness.onFilterChange?.('brand', 'Apple');
    });
    await act(async () => {
      await filterHarness.onFilterChange?.('graphics', 'NVIDIA RTX 4070');
    });

    // No server navigation: the brand selection survives the graphics toggle.
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: 'RTX Apple Laptop' })).toBeInTheDocument();
    expect(
      screen.queryByRole('article', { name: 'Integrated Apple Laptop' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('article', { name: 'RTX Dell Laptop' })
    ).not.toBeInTheDocument();
  });

  it('keeps hub pagination on the hub route when a base override is provided', () => {
    mockMatchMedia(true);
    vi.mocked(useParams).mockReturnValue({
      slug: 'test',
      category: 'gaming-laptops',
    });

    const products = Array.from({ length: 20 }, (_, index) => ({
      ...PRODUCT_WITH_IMAGE,
      id: String(index + 1),
      name: `Product ${index + 1}`,
    }));

    render(
      <CategoryPage
        currentPage={2}
        products={products}
        productsArePrePaginated={true}
        totalProductCount={45}
        graphicsOptions={['NVIDIA RTX 4070']}
        selectedGraphics={['NVIDIA RTX 4070']}
        paginationBasePath="/test-store/gaming-laptops/graphics/rtx-4070"
      />
    );

    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/test-store/gaming-laptops/graphics/rtx-4070'
    );
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      '/test-store/gaming-laptops/graphics/rtx-4070?page=3'
    );
  });
});
