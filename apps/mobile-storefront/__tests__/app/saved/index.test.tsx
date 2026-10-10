/**
 * Regression tests for SavedItemsScreen
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import type { SavedItem } from '@/stores/saved-store';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    data: unknown[];
    renderItem: (info: { item: unknown }) => ReactNode;
    ListHeaderComponent?: () => ReactNode;
    ListEmptyComponent?: () => ReactNode;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const MockView =
      jest.requireActual<typeof import('react-native')>('react-native').View;

    return React.createElement(
      MockView,
      null,
      ListHeaderComponent?.(),
      data.length === 0
        ? ListEmptyComponent?.()
        : data.map((item, index) =>
            React.createElement(
              MockView,
              { key: `flash-item-${index}` },
              renderItem({ item })
            )
          )
    );
  },
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual<typeof import('react-native')>('react-native')
      .View,
  },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  Layout: { springify: () => ({}) },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const mockItems = jest.fn<() => SavedItem[]>(() => []);
const mockRemoveItem = jest.fn();
const mockClearSaved = jest.fn();
const mockAddItem = jest.fn();

jest.mock('@/stores/saved-store', () => ({
  useSavedStore: (selector: (state: unknown) => unknown) =>
    selector({
      items: mockItems(),
      removeItem: mockRemoveItem,
      clearSaved: mockClearSaved,
    }),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: unknown) => unknown) =>
    selector({
      addItem: mockAddItem,
    }),
}));

jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'L~I64nofj[ayj[ayj[ay' },
}));

jest.mock('@/constants/Colors', () => ({
  __esModule: true,
  default: {
    light: {
      background: '#fff',
      text: '#000',
      textSecondary: '#666',
      card: '#f0f0f0',
      border: '#ddd',
    },
  },
  BRAND: { primary: '#007AFF' },
  RADIUS: { lg: 12, md: 8, sm: 4 },
  SHADOWS: { sm: {} },
  SPACING: { md: 16, lg: 24, xl: 32, sm: 8, xs: 4 },
}));

jest.mock('@/types/product', () => ({
  formatPrice: (price: number) => `₦${price}`,
  getDiscountPercentage: () => null,
}));

import SavedItemsScreen from '@/app/saved';

const makeSavedItem = (overrides: Partial<SavedItem> = {}): SavedItem => ({
  id: 'item-1',
  product_id: 'prod-1',
  name: 'Test Phone',
  slug: 'test-phone',
  price: 50000,
  image: 'https://example.com/image.jpg',
  savedAt: Date.now(),
  ...overrides,
});

describe('SavedItemsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockItems.mockReturnValue([]);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('does not navigate when the saved item has no slug', () => {
    const itemWithoutSlug = makeSavedItem({ slug: '' });
    mockItems.mockReturnValue([itemWithoutSlug]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Test Phone'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates to product page when slug is present', () => {
    const itemWithSlug = makeSavedItem({ slug: 'test-phone' });
    mockItems.mockReturnValue([itemWithSlug]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Test Phone'));

    expect(mockPush).toHaveBeenCalledWith('/product/test-phone');
  });

  it('forwards exact saved match ids without the snapshot condition', () => {
    const matchedItem = makeSavedItem({
      slug: 'iphone-15',
      match_variant_id: 'variant-blue-128',
      match_offer_id: 'offer-open-box',
      match_condition: 'open_box',
    });
    mockItems.mockReturnValue([matchedItem]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Test Phone'));

    // The persisted condition can be stale (the merchant reconditioned the
    // option after saving); the PDP derives the live condition from the
    // exact id instead.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: {
        slug: 'iphone-15',
        variant_id: 'variant-blue-128',
        offer_id: 'offer-open-box',
      },
    });
  });

  it('forwards the saved condition when no exact id was persisted', () => {
    const matchedItem = makeSavedItem({
      slug: 'iphone-15',
      match_condition: 'used',
    });
    mockItems.mockReturnValue([matchedItem]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Test Phone'));

    // A condition without ids is a base-row match (match fields persist
    // only from searchMatch): the base marker keeps the PDP on the saved
    // base price instead of a same-condition offer.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: {
        slug: 'iphone-15',
        condition: 'used',
        match_base: '1',
      },
    });
  });

  it('routes saved SKU-matrix products to detail selection instead of direct cart add', () => {
    const skuMatrixItem = makeSavedItem({
      name: 'iPhone 15',
      slug: 'iphone-15',
      has_variants: true,
      variant_model: 'sku_matrix',
      available_conditions: ['open_box', 'used'],
      has_condition_offers: true,
    });
    mockItems.mockReturnValue([skuMatrixItem]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Add to Cart'));

    expect(mockPush).toHaveBeenCalledWith('/product/iphone-15');
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('adds saved simple products directly when trusted metadata says no selection is required', () => {
    const simpleItem = makeSavedItem({
      has_variants: false,
      variant_model: 'legacy',
      available_conditions: ['new'],
      has_condition_offers: false,
    });
    mockItems.mockReturnValue([simpleItem]);

    render(<SavedItemsScreen />);

    fireEvent.press(screen.getByText('Add to Cart'));

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 'prod-1',
        slug: 'test-phone',
        quantity: 1,
      })
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
