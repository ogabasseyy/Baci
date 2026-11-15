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
  mockUseCategories,
  mockUseLocalSearchParams,
  mockUseProducts,
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

  it('keeps unfiltered catalog queries disabled for unknown category slugs', () => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'missing-category' });
    setProductsState({ products: [] });
    render(<CategoryScreen />);
    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(screen.getByText('Invalid Category')).toBeTruthy();
  });

  it.each([
    { slug: ' Phones ', catalogSlug: 'smartphones' },
    { slug: 'SMARTPHONES', catalogSlug: 'phones' },
    { slug: 'mobile-phones', catalogSlug: 'phones' },
  ])('resolves $slug to catalog category $catalogSlug', ({
    slug,
    catalogSlug,
  }) => {
    mockUseLocalSearchParams.mockReturnValue({
      slug,
      sort: 'newest',
    });
    mockUseCategories.mockReturnValue({
      data: [{ id: 'smartphone-category', slug: catalogSlug }],
      isLoading: false,
    });

    render(<CategoryScreen />);

    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'smartphone-category',
        enabled: true,
        sortBy: 'newest',
      })
    );
  });

  it('prefers the canonical phone alias over the first catalog match', () => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'mobile-phones' });
    mockUseCategories.mockReturnValue({
      data: [
        { id: 'smartphones', slug: 'smartphones' },
        { id: 'phones', slug: 'phones' },
      ],
      isLoading: false,
    });

    render(<CategoryScreen />);
    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'phones', enabled: true })
    );
  });

  it.each([
    { sort: 'price-asc', expected: 'price_asc' },
    { sort: 'price-desc', expected: 'price_desc' },
    { sort: 'unsupported', expected: undefined },
  ])('normalizes catalog sort $sort', ({ sort, expected }) => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'accessories', sort });
    render(<CategoryScreen />);
    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: expected })
    );
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
