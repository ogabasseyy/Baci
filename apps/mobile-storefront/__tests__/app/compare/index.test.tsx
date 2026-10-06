import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockPush = jest.fn();
const mockAddItem = jest.fn();
const mockRemoveProduct = jest.fn();
const mockClearComparison = jest.fn();

const mockComparisonState = {
  products: [] as Array<{
    id: string;
    slug: string;
    name: string;
    price: number;
    image?: string;
    compare_at_price?: number;
    condition?: string;
    brand?: string;
    specifications?: Record<string, string>;
    rating?: number;
    has_variants?: boolean;
    variant_model?: 'legacy' | 'sku_matrix';
    available_conditions?: string[];
    has_condition_offers?: boolean;
    searchMatch?: {
      variantId?: string;
      offerId?: string;
      condition?: string;
    };
  }>,
  removeProduct: mockRemoveProduct,
  clearComparison: mockClearComparison,
};

type ComparisonSelector<T> = (state: typeof mockComparisonState) => T;

const mockUseShallow = jest.fn(
  <T,>(selector: ComparisonSelector<T>) => selector
);

const mockUseComparisonStore = jest.fn(<T,>(selector: ComparisonSelector<T>) =>
  selector(mockComparisonState)
);

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight?.() ?? null,
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: (selector: (state: typeof mockComparisonState) => unknown) =>
    mockUseShallow(selector),
}));

jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'L~I64nofj[ayj[ayj[ay' },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/stores/comparison-store', () => ({
  useComparisonStore: (
    selector: (state: typeof mockComparisonState) => unknown
  ) => mockUseComparisonStore(selector),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (
    selector: (state: { addItem: typeof mockAddItem }) => unknown
  ) => selector({ addItem: mockAddItem }),
}));

jest.mock('@/hooks/use-comparison-products', () => ({
  useComparisonProducts: (products: unknown[]) => ({
    products,
    status: 'Current product prices. Select options on the product page.',
  }),
}));

import CompareScreen from '@/app/compare';

describe('CompareScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComparisonState.products = [];
  });

  it('renders comparison products and clears the comparison', () => {
    mockComparisonState.products = [
      {
        id: 'product-1',
        slug: 'test-product',
        name: 'Test Product',
        price: 1999,
      },
    ];

    render(<CompareScreen />);

    expect(screen.getByText('Test Product')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Clear comparison' }));
    expect(mockClearComparison).toHaveBeenCalledTimes(1);
  });

  it('renders empty state and routes to browse products', () => {
    render(<CompareScreen />);

    expect(screen.getByText('No products to compare')).toBeTruthy();

    fireEvent.press(screen.getByText('Browse Products'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('routes SKU-matrix products to detail selection instead of adding the parent product', () => {
    mockComparisonState.products = [
      {
        id: 'product-1',
        slug: 'iphone-15',
        name: 'iPhone 15',
        price: 900000,
        has_variants: true,
        variant_model: 'sku_matrix',
        available_conditions: ['open_box', 'used'],
        has_condition_offers: true,
      },
    ];

    render(<CompareScreen />);

    fireEvent.press(screen.getByText('View options'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'iphone-15' },
    });
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('routes persisted simple products to current details without adding stale prices', () => {
    mockComparisonState.products = [
      {
        id: 'product-1',
        slug: 'test-product',
        name: 'Test Product',
        price: 1999,
        has_variants: false,
        variant_model: 'legacy',
        available_conditions: ['new'],
        has_condition_offers: false,
      },
    ];

    render(<CompareScreen />);

    fireEvent.press(screen.getByText('View options'));

    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'test-product' },
    });
  });

  it('opens matched rows with exact ids and omits the snapshot condition', () => {
    mockComparisonState.products = [
      {
        id: 'product-1',
        slug: 'iphone-15',
        name: 'iPhone 15',
        price: 900000,
        searchMatch: { offerId: 'offer-open-box', condition: 'open_box' },
      },
    ];

    render(<CompareScreen />);

    // Refresh failure and unavailable rows fall back to the snapshot, so
    // the forwarded condition can be stale; the PDP derives the live one.
    fireEvent.press(screen.getByRole('button', { name: 'View iPhone 15' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'iphone-15', offer_id: 'offer-open-box' },
    });
  });

  it('marks ID-less base matches so the PDP keeps the base price', () => {
    mockComparisonState.products = [
      {
        id: 'product-1',
        slug: 'iphone-15',
        name: 'iPhone 15',
        price: 900000,
        searchMatch: { condition: 'used' },
      },
    ];

    render(<CompareScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'View iPhone 15' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'iphone-15', condition: 'used', match_base: '1' },
    });
  });
});
