import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import CategoryScreen from '@/app/category/[slug]';

interface MockFlashListProps {
  children?: React.ReactNode;
  [key: string]: unknown;
}

interface MockCategoryFlashListProps extends MockFlashListProps {
  onEndReached?: () => void;
  ListFooterComponent?: React.ComponentType | (() => React.ReactNode);
  refreshControl?: {
    props: {
      onRefresh?: () => Promise<void> | void;
    };
  };
}

type MockCategoryListStyleOptions = {
  includeBottomInset?: boolean;
  paddingBottom?: number;
  paddingTop?: number;
};

type MockStorefrontScreenShellProps = {
  children?: React.ReactNode;
  [key: string]: unknown;
};

const mockFlashList = jest.fn(({ children, ...props }: MockFlashListProps) => (
  <View testID="category-flash-list" {...props}>
    {children}
  </View>
));
const mockStorefrontScreenShell = jest.fn(
  ({ children, ...props }: MockStorefrontScreenShellProps) => (
    <View testID="storefront-screen-shell" {...props}>
      {children}
    </View>
  )
);
const mockGetListContentStyle =
  jest.fn<
    (options?: MockCategoryListStyleOptions) => {
      paddingTop: number;
      paddingBottom: number;
    }
  >();
const mockUseStorefrontInsets = jest.fn();
const mockUseCategories = jest.fn();
const mockUseProducts = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockRefetch = jest.fn(async () => undefined);
const mockLoadMore = jest.fn();
const mockRouterPush = jest.fn();
const defaultProduct = {
  id: 'product-1',
  slug: 'test-product',
};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data = [],
    renderItem,
    ListEmptyComponent,
    children,
    ...props
  }: {
    data?: Array<{ id: string }>;
    children?: React.ReactNode;
    renderItem?: (info: {
      item: { id: string };
      index: number;
    }) => React.ReactNode;
    ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { View } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    const content =
      data.length === 0
        ? typeof ListEmptyComponent === 'function'
          ? ListEmptyComponent()
          : ListEmptyComponent
        : data.map((item, index) =>
            React.createElement(
              View,
              { key: item.id },
              renderItem ? renderItem({ item, index }) : null
            )
          );

    return mockFlashList({
      children: content ?? children,
      ...props,
      data,
      renderItem,
      ListEmptyComponent,
    });
  },
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  }) => mockStorefrontScreenShell({ children, ...props }),
}));

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => mockUseStorefrontInsets(),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
  useProducts: () => mockUseProducts(),
}));

jest.mock('@/components/ads/AdSlot', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
});

jest.mock('@/components/storefront/ProductCard', () => ({
  ProductCard: ({
    product,
    onPress,
  }: {
    product: { slug: string };
    onPress?: () => void;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Pressable, Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(
      Pressable,
      {
        accessibilityRole: 'button',
        accessibilityLabel: `Open ${product.slug}`,
        onPress,
      },
      React.createElement(Text, null, product.slug)
    );
  },
}));

describe('CategoryScreen', () => {
  const getFlashListProps = () =>
    mockFlashList.mock.calls[0]?.[0] as MockCategoryFlashListProps | undefined;
  const getLatestFlashListProps = () =>
    mockFlashList.mock.calls.at(-1)?.[0] as
      | MockCategoryFlashListProps
      | undefined;
  const setProductsState = ({
    error = null,
    hasMore = false,
    isLoading = false,
    products = [defaultProduct],
  }: Partial<{
    error: string | null;
    hasMore: boolean;
    isLoading: boolean;
    products: Array<{ id: string; slug: string }>;
  }> = {}) => {
    mockUseProducts.mockReturnValue({
      products,
      isLoading,
      error,
      hasMore,
      refetch: mockRefetch,
      loadMore: mockLoadMore,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetListContentStyle.mockImplementation(
      (options?: MockCategoryListStyleOptions) => ({
        paddingTop: options?.paddingTop ?? 16,
        paddingBottom:
          (options?.paddingBottom ?? 16) +
          (options?.includeBottomInset === false ? 0 : 34),
      })
    );
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'accessories',
    });
    mockUseStorefrontInsets.mockReturnValue({
      getScrollContentStyle: jest.fn(),
      getListContentStyle: mockGetListContentStyle,
    });
    mockUseCategories.mockReturnValue({
      data: [
        {
          id: 'category-1',
          slug: 'accessories',
        },
      ],
      isLoading: false,
    });
    setProductsState();
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

  it('calls loadMore when the list reaches the end and more products are available', () => {
    setProductsState({ hasMore: true });

    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();

    flashListProps?.onEndReached?.();

    expect(mockLoadMore).toHaveBeenCalled();
  });

  it.each([
    {
      hasMore: true,
      isLoading: true,
      scenario: 'the list is already loading',
    },
    {
      hasMore: false,
      isLoading: false,
      scenario: 'there are no more products',
    },
  ])('does not call loadMore when $scenario', ({ hasMore, isLoading }) => {
    setProductsState({ hasMore, isLoading });

    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();

    flashListProps?.onEndReached?.();

    expect(mockLoadMore).not.toHaveBeenCalled();
  });

  it('calls refetch when the list is pulled to refresh', async () => {
    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();
    const onRefresh = flashListProps?.refreshControl?.props.onRefresh;

    expect(onRefresh).toBeDefined();

    if (onRefresh) {
      await act(async () => {
        await onRefresh();
      });
    }

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('navigates to the product detail screen when a product is pressed', () => {
    render(<CategoryScreen />);

    fireEvent.press(screen.getByLabelText('Open test-product'));

    expect(mockRouterPush).toHaveBeenCalledWith('/product/test-product');
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
