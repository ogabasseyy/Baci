import { jest } from '@jest/globals';
import { View } from 'react-native';

// Shared mocks, builders, and module factories for the category suites
// (core + list behaviors + ad slots). Pure module on purpose: jest.mock
// hoisting is per-file, so each suite registers its own mocks by calling
// these factories. Factories are mock-prefixed because factory bodies may
// only reference mock-prefixed imports.

export interface MockFlashListProps {
  children?: React.ReactNode;
  [key: string]: unknown;
}

export interface MockCategoryFlashListProps extends MockFlashListProps {
  onEndReached?: () => void;
  ListFooterComponent?: React.ComponentType | (() => React.ReactNode);
  refreshControl?: {
    props: {
      onRefresh?: () => Promise<void> | void;
    };
  };
}

export type MockCategoryListStyleOptions = {
  includeBottomInset?: boolean;
  paddingBottom?: number;
  paddingTop?: number;
};

export type MockStorefrontScreenShellProps = {
  children?: React.ReactNode;
  [key: string]: unknown;
};

export const mockFlashList = jest.fn(
  ({ children, ...props }: MockFlashListProps) => (
    <View testID="category-flash-list" {...props}>
      {children}
    </View>
  )
);
export const mockStorefrontScreenShell = jest.fn(
  ({ children, ...props }: MockStorefrontScreenShellProps) => (
    <View testID="storefront-screen-shell" {...props}>
      {children}
    </View>
  )
);
export const mockGetListContentStyle =
  jest.fn<
    (options?: MockCategoryListStyleOptions) => {
      paddingTop: number;
      paddingBottom: number;
    }
  >();
export const mockUseStorefrontInsets = jest.fn();
export const mockUseCategories = jest.fn();
export const mockUseProducts = jest.fn();
export const mockUseLocalSearchParams = jest.fn();
export const mockRefetch = jest.fn(async () => undefined);
export const mockLoadMore = jest.fn();
export const mockRouterPush = jest.fn();
export const defaultProduct = {
  id: 'product-1',
  slug: 'test-product',
};

export function mockExpoRouterModule(): unknown {
  return {
    Stack: {
      Screen: () => null,
    },
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
  };
}

export function mockFlashListModule(): unknown {
  return {
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
  };
}

export function mockStorefrontScreenShellModule(): unknown {
  return {
    StorefrontScreenShell: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => mockStorefrontScreenShell({ children, ...props }),
  };
}

export function mockStorefrontInsetsModule(): unknown {
  return { useStorefrontInsets: () => mockUseStorefrontInsets() };
}

export function mockHooksModule(): unknown {
  return {
    useCategories: () => mockUseCategories(),
    useProducts: () => mockUseProducts(),
  };
}

export function mockAdSlotModule(): unknown {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
}

export function mockProductCardModule(): unknown {
  return {
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
  };
}

export const getFlashListProps = () =>
  mockFlashList.mock.calls[0]?.[0] as MockCategoryFlashListProps | undefined;
export const getLatestFlashListProps = () =>
  mockFlashList.mock.calls.at(-1)?.[0] as
    | MockCategoryFlashListProps
    | undefined;

export const setProductsState = ({
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

export function setupCategoryMocks(): void {
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
}
