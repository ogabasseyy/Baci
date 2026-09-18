import type React from 'react';
import { vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import type { Product } from '@/lib/products';

/**
 * Shared arrange-state for StorefrontProductGrid test modules. The state
 * lives in one hoisted holder (vitest forbids exporting hoisted variables
 * directly); factories read the holder and tests use the derived exports.
 */
const fixtureState = vi.hoisted(() => ({
  basePath: '',
  merchant: {
    id: 'm1',
    slug: 'test-merchant',
    brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
    navigationCategories: [{ name: 'Fashion' }, { name: 'Other' }],
  } as {
    id: string;
    slug: string;
    business_type?: string;
    brand_colors: { primary: string; background: string; accent: string };
    navigationCategories: { name: string }[];
  },
  searchQuery: '',
  selectedCategory: 'All',
  product: {
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
  } as Product,
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

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/optimized-image', () => ({
  ProductCardImage: () => <div data-testid="product-image" />,
}));

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
    merchant: fixtureState.merchant,
    basePath: fixtureState.basePath,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: unknown) => value,
}));

vi.mock('@/contexts/storefront-context', () => ({
  useStorefrontSafe: () => ({
    get searchQuery() {
      return fixtureState.searchQuery;
    },
    get selectedCategory() {
      return fixtureState.selectedCategory;
    },
    setSearchQuery: vi.fn((query: string) => {
      fixtureState.searchQuery = query;
    }),
    setSelectedCategory: vi.fn(),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn().mockImplementation((url) => {
    if (url.includes('/api/storefront/products')) {
      return Promise.resolve({ products: [fixtureState.product] });
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
    <a aria-label="Card base path" href={basePath || '/'}>
      {product.name}
    </a>
  ),
}));

vi.mock('./quick-view-modal', () => ({
  QuickViewModal: ({ basePath }: { basePath?: string }) => (
    <a href={basePath || '/'}>Quick view base path</a>
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

/** Mutable arrange-state views shared by grid test modules. */
export const mockMerchantState = {
  get basePath() {
    return fixtureState.basePath;
  },
  set basePath(value: string) {
    fixtureState.basePath = value;
  },
  get merchant() {
    return fixtureState.merchant;
  },
  set merchant(value: typeof fixtureState.merchant) {
    fixtureState.merchant = value;
  },
};

export const mockStorefrontUiState = {
  get searchQuery() {
    return fixtureState.searchQuery;
  },
  set searchQuery(value: string) {
    fixtureState.searchQuery = value;
  },
  get selectedCategory() {
    return fixtureState.selectedCategory;
  },
  set selectedCategory(value: string) {
    fixtureState.selectedCategory = value;
  },
};

/** Basic product mock shared by grid test modules. */
export const mockProduct: Product = fixtureState.product;

export function previewMerchantState() {
  return {
    id: 'preview-merchant-id',
    slug: 'preview-store',
    business_type: 'food-beverage',
    brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
    navigationCategories: [{ name: 'Food & Beverage' }],
  };
}

/** Reset shared arrange-state between tests. */
export function resetProductGridTestState() {
  fixtureState.searchQuery = '';
  fixtureState.selectedCategory = 'All';
  fixtureState.basePath = '';
  fixtureState.merchant = {
    id: 'm1',
    slug: 'test-merchant',
    brand_colors: { primary: '#000', background: '#fff', accent: '#ccc' },
    navigationCategories: [{ name: 'Fashion' }, { name: 'Other' }],
  };
}

export { apiGet };
