import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddToCart = vi.fn();
const mockRouterPush = vi.hoisted(() => vi.fn());

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
vi.mock('../components/CategoryFiltersSidebar', () => ({
  CategoryFiltersSidebar: () => null,
}));
vi.mock('@/lib/yield-to-scheduler', () => ({
  yieldToScheduler: vi.fn(() => Promise.resolve()),
}));
vi.mock('../components/ProductCard', () => ({
  ProductCard: ({
    product,
    imagePriority,
  }: {
    product: { name: string };
    imagePriority?: boolean;
  }) => (
    <article
      aria-label={product.name}
      data-image-priority={imagePriority ? 'true' : 'false'}
    >
      <span>{product.name}</span>
    </article>
  ),
}));

import { CategoryPage } from './category-page';

describe('CategoryPage a11y and first-row LCP prioritization', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    window.history.replaceState({}, '', '/test-store/electronics');
    mockAddToCart.mockReset();
    mockRouterPush.mockReset();
  });

  it('prioritizes the first 2 grid cards without over-fetching on mobile and exposes 44px accessible view toggle buttons', () => {
    const products = Array.from({ length: 4 }, (_, index) => ({
      id: String(index + 1),
      name: `Phone ${index + 1}`,
      slug: `phone-${index + 1}`,
      description: `Description ${index + 1}`,
      price: `₦${index + 1}`,
      rawPrice: index + 1,
      image: `/phone-${index + 1}.jpg`,
      condition: 'New' as const,
    }));

    render(<CategoryPage prioritizeFirstRowImages products={products} />);

    const gridButton = screen.getByRole('button', { name: 'Grid view' });
    const listButton = screen.getByRole('button', { name: 'List view' });
    expect(gridButton).toHaveAttribute('aria-pressed', 'true');
    expect(gridButton).toHaveClass('min-h-11', 'min-w-11');
    expect(listButton).toHaveAttribute('aria-pressed', 'false');
    expect(listButton).toHaveClass('min-h-11', 'min-w-11');

    expect(
      screen.getByRole('article', { name: 'Phone 1' })
    ).toHaveAttribute('data-image-priority', 'true');
    expect(
      screen.getByRole('article', { name: 'Phone 2' })
    ).toHaveAttribute('data-image-priority', 'true');
    expect(
      screen.getByRole('article', { name: 'Phone 3' })
    ).toHaveAttribute('data-image-priority', 'false');
    expect(
      screen.getByRole('article', { name: 'Phone 4' })
    ).toHaveAttribute('data-image-priority', 'false');
  });
});
