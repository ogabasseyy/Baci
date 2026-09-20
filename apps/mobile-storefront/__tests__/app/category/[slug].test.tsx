import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import {
  mockAdSlotModule,
  mockExpoRouterModule,
  mockFlashList,
  mockFlashListModule,
  mockGetListContentStyle,
  mockHooksModule,
  mockProductCardModule,
  mockStorefrontInsetsModule,
  mockStorefrontScreenShell,
  mockStorefrontScreenShellModule,
  mockUseLocalSearchParams,
  setProductsState,
  setupCategoryMocks,
} from './category.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@shopify/flash-list', () => mockFlashListModule());
jest.mock('@/components/storefront/StorefrontScreenShell', () =>
  mockStorefrontScreenShellModule()
);
jest.mock('@/hooks/use-storefront-insets', () => mockStorefrontInsetsModule());
jest.mock('@/hooks', () => mockHooksModule());
jest.mock('@/components/ads/AdSlot', () => mockAdSlotModule());
jest.mock('@/components/storefront/ProductCard', () => mockProductCardModule());

import CategoryScreen from '@/app/category/[slug]';

describe('CategoryScreen', () => {
  beforeEach(() => {
    setupCategoryMocks();
  });

  it('uses the storefront shell and list padding helper for category browsing', () => {
    render(<CategoryScreen />);
    const shellProps = mockStorefrontScreenShell.mock.calls[0]?.[0];
    const flashListProps = mockFlashList.mock.calls[0]?.[0];

    expect(shellProps?.edges).toEqual(['bottom']);
    expect(mockGetListContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: 24,
      paddingTop: 16,
    });
    expect(flashListProps?.contentContainerStyle).toEqual({
      paddingTop: 16,
      paddingBottom: 24,
    });
  });

  it('renders an invalid-category state when the slug is empty', () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: '',
    });
    setProductsState({ products: [] });

    render(<CategoryScreen />);

    expect(screen.getByText('Invalid Category')).toBeTruthy();
  });

  it('renders the loading state while category products are being fetched', () => {
    setProductsState({
      isLoading: true,
      products: [],
    });

    render(<CategoryScreen />);

    expect(screen.getByText('Loading products…')).toBeTruthy();
  });

  it('renders the fetch error state when product loading fails', () => {
    setProductsState({
      error: 'Failed to load products',
      products: [],
    });

    render(<CategoryScreen />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Failed to load products')).toBeTruthy();
  });

  it('renders the empty state when a category has no products', () => {
    setProductsState({ products: [] });

    render(<CategoryScreen />);

    expect(screen.getByText('No products found')).toBeTruthy();
  });
});
