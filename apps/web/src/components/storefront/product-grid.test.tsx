import { render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import type { Product } from '@/lib/products';
import { StorefrontProductGrid } from './product-grid';

const mockMerchantState = vi.hoisted<{
  basePath: string;
  merchant: {
    id: string;
    slug: string;
    business_type?: string;
    brand_colors: { primary: string; background: string; accent: string };
    navigationCategories: { name: string }[];
  };
}>(() => ({
  basePath: '',
  merchant: {
    id: 'm1',
    slug: 'test-merchant',
    brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
    navigationCategories: [{ name: 'Fashion' }, { name: 'Other' }],
  },
}));

// Mock dependencies
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/optimized-image', () => ({
  ProductCardImage: () => <div data-testid="product-image" />,
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
  'aria-pressed'?: boolean;
  variant?: string;
  colorRole?: string;
  size?: string;
  className?: string;
}

interface MockBadgeProps {
  children: React.ReactNode;
  variant?: string;
  className?: string;
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
    'aria-pressed': ariaPressed,
  }: MockButtonProps) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
    >
      {children}
    </button>
  ),
  ThemedBadge: ({ children }: MockBadgeProps) => <span>{children}</span>,
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
    formatCurrencyCompact: (amount: number) => `$${amount}`,
  }),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    cart: [],
    addToCart: vi.fn(),
    updateQuantity: vi.fn(),
    setMerchantSlug: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    merchant: mockMerchantState.merchant,
    basePath: mockMerchantState.basePath,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: any) => value,
}));

vi.mock('@/contexts/storefront-context', () => ({
  useStorefrontSafe: () => ({
    searchQuery: '',
    selectedCategory: 'All',
    setSearchQuery: vi.fn(),
    setSelectedCategory: vi.fn(),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn().mockImplementation((url) => {
    if (url.includes('/api/storefront/products')) {
      return Promise.resolve({ products: [mockProduct] });
    }
    if (url.includes('/api/products/count')) {
      return Promise.resolve({ count: 1, recommendedMethod: 'client' });
    }
    return Promise.resolve({});
  }),
}));

vi.mock('@/lib/category-sorting', () => ({
  sortCategories: ({ categories }: { categories: string[] }) => categories,
}));

vi.mock('@/lib/color-utils', () => ({
  findDarkestColor: () => '#000',
}));

vi.mock('./did-you-mean-banner', () => ({
  DidYouMeanBanner: () => <div>Did you mean banner</div>,
}));

vi.mock('./product-card', () => ({
  StorefrontProductCard: ({
    product,
    basePath,
  }: {
    product: Product;
    basePath?: string;
  }) => (
    <div data-testid="product-card" data-base-path={basePath}>
      {product.name}
    </div>
  ),
}));

vi.mock('./quick-view-modal', () => ({
  QuickViewModal: ({ basePath }: { basePath?: string }) => (
    <div data-testid="quick-view" data-base-path={basePath} />
  ),
  useQuickView: () => ({
    product: null,
    isOpen: false,
    openQuickView: vi.fn(),
    closeQuickView: vi.fn(),
  }),
}));

vi.mock('@/components/ui/skeletons', () => ({
  ProductGridSkeleton: () => <div data-testid="grid-skeleton" />,
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
  category: 'Fashion',
  gtin: '123',
  mpn: 'MPN',
};

describe('StorefrontProductGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMerchantState.basePath = '';
    mockMerchantState.merchant = {
      id: 'm1',
      slug: 'test-merchant',
      brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
      navigationCategories: [{ name: 'Fashion' }, { name: 'Other' }],
    };
  });

  it.each([
    '',
    '/test-merchant',
  ])('passes routing basePath %s to cards and quick view', async (basePath) => {
    mockMerchantState.basePath = basePath;
    render(<StorefrontProductGrid />);
    expect(await screen.findByTestId('product-card')).toHaveAttribute(
      'data-base-path',
      basePath
    );
    expect(screen.getByTestId('quick-view')).toHaveAttribute(
      'data-base-path',
      basePath
    );
  });

  it('renders without crashing', async () => {
    render(<StorefrontProductGrid />);
    await waitFor(() => {
      expect(screen.getByText('Test Product')).toBeInTheDocument();
    });
    // This guards the stale-list regression found in Chrome after creating a
    // dashboard product and reopening the generated storefront.
    expect(apiGet).toHaveBeenCalledWith(
      '/api/storefront/products?merchant_id=m1&compact=true&has_images=true',
      { cache: 'no-store' }
    );
  });

  it('renders category buttons with correct aria-pressed state', async () => {
    render(<StorefrontProductGrid />);
    await waitFor(() => {
      // 'Fashion' is not selected by default ('All' is)
      const fashionButton = screen.getByText('Fashion').closest('button');
      expect(fashionButton).toHaveAttribute('aria-pressed', 'false');

      // 'All' should be selected
      const allButton = screen.getByText('All').closest('button');
      expect(allButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('renders live region with correct status text', async () => {
    render(<StorefrontProductGrid />);

    // Initially it might be loading, but we wait for products
    await waitFor(() => {
      // We mocked 1 product
      const expectedText = /1 product found/i;
      // We look for the live region specifically
      // In our implementation: <output class="sr-only" aria-live="polite">

      // Since screen.getByRole('status') might be ambiguous if multiple exist,
      // but we only added one <output> which has implicit status role.
      // However, explicit aria-live="polite" is key.

      // We can also query by text directly if it's the only place with that text.
      expect(screen.getByText(expectedText)).toBeInTheDocument();

      // Check that it is indeed in a live region (roughly)
      const liveRegion = screen
        .getByText(expectedText)
        .closest('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
    });
  });

  it('uses industry-specific sample products in preview mode', async () => {
    mockMerchantState.merchant = {
      id: 'preview-merchant-id',
      slug: 'preview-store',
      business_type: 'food-beverage',
      brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
      navigationCategories: [{ name: 'Food & Beverage' }],
    };

    render(<StorefrontProductGrid />);

    expect(
      await screen.findByText('Artisanal Sourdough Loaf')
    ).toBeInTheDocument();
    expect(screen.queryByText('Linen Summer Dress')).not.toBeInTheDocument();
    expect(
      vi
        .mocked(apiGet)
        .mock.calls.some(([url]) =>
          String(url).includes('/api/storefront/products')
        )
    ).toBe(false);
  });
});
