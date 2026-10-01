import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { StorefrontProductCard } from './product-card';

// Mock dependencies
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/optimized-image', () => ({
  ProductCardImage: ({ alt }: { alt: string }) => (
    <div data-testid="product-image" role="img" aria-label={alt} />
  ),
}));

interface MockCardProps {
  children: React.ReactNode;
  className?: string;
}

interface MockButtonProps {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  'aria-label'?: string;
}

interface MockBadgeProps {
  children: React.ReactNode;
}

vi.mock('@/components/themed', () => ({
  ThemedCard: ({ children, className }: MockCardProps) => (
    <div className={className}>{children}</div>
  ),
  ThemedButton: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: MockButtonProps) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  ThemedBadge: ({ children }: MockBadgeProps) => <span>{children}</span>,
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
  }),
}));

vi.mock('@/lib/seo-utils', () => ({
  getProductUrl: () => '/product/test',
}));

// Basic product mock
const mockProduct: Product = {
  id: 'p1',
  name: 'Test Product',
  description: 'A test product',
  status: 'active',
  price: 100,
  manage_stock: true,
  stock: 10,
  image: 'img.jpg',
  imageLarge: 'img-large.jpg',
  imageHint: 'hint',
  brand: 'Brand',
  gtin: '123',
  mpn: 'MPN',
};

describe('StorefrontProductCard', () => {
  const mockAddToCart = vi.fn();
  const mockUpdateQuantity = vi.fn();
  const mockQuickView = vi.fn();

  beforeEach(() => {
    mockAddToCart.mockReset();
    mockUpdateQuantity.mockReset();
    mockQuickView.mockReset();
  });

  it('renders product name and price', () => {
    render(
      <StorefrontProductCard
        product={mockProduct}
        staggerClass=""
        onAddToCart={mockAddToCart}
        onUpdateQuantity={mockUpdateQuantity}
        onQuickView={mockQuickView}
      />
    );

    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('prefixes product links only with the routing base path', () => {
    render(
      <StorefrontProductCard
        product={mockProduct}
        staggerClass=""
        basePath="/test-store"
        onAddToCart={mockAddToCart}
        onUpdateQuantity={mockUpdateQuantity}
        onQuickView={mockQuickView}
      />
    );

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/test-store/product/test'
    );
  });

  it('generates product links when basePath is not provided', () => {
    render(
      <StorefrontProductCard
        product={mockProduct}
        staggerClass=""
        onAddToCart={mockAddToCart}
        onUpdateQuantity={mockUpdateQuantity}
        onQuickView={mockQuickView}
      />
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/product/test');
  });

  it('handles empty domain-routing basePath gracefully', () => {
    render(
      <StorefrontProductCard
        product={mockProduct}
        staggerClass=""
        basePath=""
        onAddToCart={mockAddToCart}
        onUpdateQuantity={mockUpdateQuantity}
        onQuickView={mockQuickView}
      />
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/product/test');
  });
});
