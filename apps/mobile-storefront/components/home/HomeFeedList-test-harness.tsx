import { jest } from '@jest/globals';
import type { Block } from '@/types/blocks';
import type { Product } from '@/types/product';
import { useHomeProductFeed } from './use-home-product-feed';

// Shared mocks, builders, and module factories for the HomeFeedList suites
// (core + ad slots). Pure module on purpose: jest.mock hoisting is
// per-file, so each suite registers its own mocks from these factories and
// mock handles. Factories are mock-prefixed because factory bodies may only
// reference mock-prefixed imports.

export const mockScrollToOffset = jest.fn();
export const mockBlockRenderer = jest.fn();
export const mockUseHomeProductFeed = useHomeProductFeed as jest.MockedFunction<
  typeof useHomeProductFeed
>;

type MockHomeFeedListItem =
  | { kind: 'product'; product: Product }
  | { kind: 'product-list-end'; id: string };

export function mockFlashListModule(): unknown {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  const FlashList = React.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        scrollToOffset: mockScrollToOffset,
      }));
      const {
        data = [],
        renderItem,
        ListHeaderComponent,
        ListFooterComponent,
        ListEmptyComponent,
        ...rest
      } = props as {
        data?: MockHomeFeedListItem[];
        renderItem?: (info: {
          item: MockHomeFeedListItem;
          index: number;
          target: 'Cell';
        }) => React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        ListFooterComponent?: React.ReactNode;
        ListEmptyComponent?: React.ReactNode;
      };
      return React.createElement(
        View,
        { testID: 'home-feed-list', ...rest },
        ListHeaderComponent,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) =>
              React.createElement(
                React.Fragment,
                {
                  key: item.kind === 'product' ? item.product.id : item.id,
                },
                renderItem?.({ item, index, target: 'Cell' })
              )
            ),
        ListFooterComponent
      );
    }
  );
  return { __esModule: true, FlashList };
}

export function mockBlockRendererModule(): unknown {
  const { View, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    BlockRenderer: (props: {
      blocks: Block[];
      suppressAds?: boolean;
      heroAdOwnerBlockId?: string | null;
    }) => {
      mockBlockRenderer(props);
      return (
        <View
          testID={
            props.suppressAds ? 'block-renderer-ads-off' : 'block-renderer'
          }
        >
          <Text>{props.blocks.length}</Text>
        </View>
      );
    },
  };
}

export function product(id: string): Product {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    price: 1000,
    image: `https://cdn.example.com/${id}.jpg`,
    images: [`https://cdn.example.com/${id}.jpg`],
  };
}

export function feed(
  overrides: Partial<ReturnType<typeof useHomeProductFeed>> = {}
): ReturnType<typeof useHomeProductFeed> {
  return {
    feedProducts: [product('p1'), product('p2')],
    isLoading: false,
    isError: false,
    isFetching: false,
    isRetrying: false,
    hasMore: true,
    loadMore: jest.fn(),
    isLoadingMore: false,
    currentVariant: 'grid',
    filterBarProps: {} as ReturnType<
      typeof useHomeProductFeed
    >['filterBarProps'],
    handleRetry: jest.fn(),
    shouldShowInitialLoading: false,
    shouldShowFatalError: false,
    feedResetKey: 'reset-1',
    ...overrides,
  };
}

export const GRID_BLOCKS = [
  { type: 'CategoryRail', props: { id: 'rail' } },
  { type: 'ProductGrid', props: { id: 'grid', title: 'Shop the collection' } },
] as unknown as Block[];

export function setupHomeFeedMocks(): void {
  jest.clearAllMocks();
  mockUseHomeProductFeed.mockReturnValue(feed());
}
