import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import {
  getLatestFlashListProps,
  mockAdSlotModule,
  mockExpoRouterModule,
  mockFlashListModule,
  mockHooksModule,
  mockProductCardModule,
  mockStorefrontInsetsModule,
  mockStorefrontScreenShellModule,
  mockUseCategories,
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

describe('CategoryScreen ad slots', () => {
  beforeEach(() => {
    setupCategoryMocks();
  });

  it('withholds the category MPU until the category resolves successfully', () => {
    // Regression: FlashList renders the footer alongside the empty
    // component, so the MPU requested under invalid/loading/error states.
    const footerElement = () => {
      const Footer = getLatestFlashListProps()?.ListFooterComponent as
        | (() => React.ReactNode)
        | undefined;
      expect(Footer).toBeDefined();
      return Footer?.() ?? null;
    };

    render(<CategoryScreen />);
    const shown = footerElement() as { props?: { placement?: string } } | null;
    expect(shown).not.toBeNull();
    expect(shown?.props?.placement).toBe('PRODUCT_GRID_MPU');

    mockUseLocalSearchParams.mockReturnValue({ slug: '' });
    setProductsState({ products: [] });
    render(<CategoryScreen />);
    expect(footerElement()).toBeNull();
  });

  it('shows the category MPU on the all-products page', () => {
    // Regression: the supported 'all' slug intentionally resolves no
    // category ID (unfiltered catalog fetch), so it must not be treated as
    // an unresolved category that withholds the placement.
    mockUseLocalSearchParams.mockReturnValue({ slug: 'all' });
    mockUseCategories.mockReturnValue({ data: [], isLoading: false });
    setProductsState();
    render(<CategoryScreen />);

    const Footer = getLatestFlashListProps()?.ListFooterComponent as
      | (() => React.ReactNode)
      | undefined;
    const shown = Footer?.() as { props?: { placement?: string } } | null;
    expect(shown).not.toBeNull();
    expect(shown?.props?.placement).toBe('PRODUCT_GRID_MPU');
  });

  it('withholds the category MPU when the resolved category is empty', () => {
    // Regression: a successful query returning zero products renders the
    // "No products found" state, so the footer must not request a
    // product-grid placement with no product feed.
    setProductsState({ products: [] });
    render(<CategoryScreen />);

    const Footer = getLatestFlashListProps()?.ListFooterComponent as
      | (() => React.ReactNode)
      | undefined;
    expect(Footer?.() ?? null).toBeNull();
  });

  it.each([
    { name: 'loading', state: { isLoading: true, products: [] } },
    {
      name: 'error',
      state: { error: 'Failed to load products', products: [] },
    },
    { name: 'unresolved slug', state: { products: [] } },
  ])('withholds the category MPU while $name', ({ state }) => {
    if ('error' in state && state.error) {
      setProductsState({ error: state.error, products: [] });
    } else if ('isLoading' in state && state.isLoading) {
      setProductsState({ isLoading: true, products: [] });
    } else {
      mockUseCategories.mockReturnValue({ data: [], isLoading: false });
      setProductsState({ products: [] });
    }
    render(<CategoryScreen />);

    const Footer = getLatestFlashListProps()?.ListFooterComponent as
      | (() => React.ReactNode)
      | undefined;
    expect(Footer?.() ?? null).toBeNull();
  });
});
