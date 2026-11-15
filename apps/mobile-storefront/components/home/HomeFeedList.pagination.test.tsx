import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { Block } from '@/types/blocks';
import type { Product } from '@/types/product';
import { HomeFeedList } from './HomeFeedList';
import { useHomeProductFeed } from './use-home-product-feed';

const mockScrollToOffset = jest.fn();

type MockHomeFeedListItem =
  | { kind: 'product'; product: Product }
  | { kind: 'product-list-end'; id: string };

jest.mock('@/hooks/use-black-friday', () => ({
  useBlackFriday: () => ({ data: [] }),
}));

jest.mock('@shopify/flash-list', () => {
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
      };
      return React.createElement(
        View,
        { testID: 'home-feed-list', ...rest },
        ListHeaderComponent,
        data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: item.kind === 'product' ? item.product.id : item.id },
            renderItem?.({ item, index, target: 'Cell' })
          )
        ),
        ListFooterComponent
      );
    }
  );
  return { __esModule: true, FlashList };
});

jest.mock('./use-home-product-feed', () => ({
  useHomeProductFeed: jest.fn(),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#000000' } }),
}));

jest.mock('@/components/storefront/BlockRenderer', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    BlockRenderer: ({
      blocks,
      renderAfterBlock,
    }: {
      blocks: Block[];
      renderAfterBlock?: (block: Block) => React.ReactNode;
    }) => (
      <View testID="block-renderer">
        {blocks.map((block) => (
          <React.Fragment
            key={`${block.type}-${(block as { props?: { id?: string } }).props?.id ?? 'unknown'}`}
          >
            {renderAfterBlock?.(block)}
          </React.Fragment>
        ))}
      </View>
    ),
  };
});

jest.mock('@/components/storefront/FilterBar', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return { FilterBar: () => <View testID="filter-bar" /> };
});

jest.mock('@/components/storefront/ProductCard', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    ProductCard: ({ product }: { product: Product }) => (
      <View testID="product-card" accessibilityLabel={product.id} />
    ),
  };
});

jest.mock('@/components/storefront/HomeServiceCards', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return { HomeServiceCards: () => <View testID="home-service-cards" /> };
});

jest.mock('@/components/ui/Skeleton', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return { ProductGridSkeleton: () => <View testID="grid-skeleton" /> };
});

const mockUseHomeProductFeed = useHomeProductFeed as jest.MockedFunction<
  typeof useHomeProductFeed
>;

function product(id: string): Product {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    price: 1000,
    image: `https://cdn.example.com/${id}.jpg`,
    images: [`https://cdn.example.com/${id}.jpg`],
  };
}

function feed(
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

const GRID_BLOCKS = [
  { type: 'CategoryRail', props: { id: 'rail' } },
  { type: 'ProductGrid', props: { id: 'grid', title: 'Shop' } },
] as unknown as Block[];

function renderList(props: Partial<Parameters<typeof HomeFeedList>[0]> = {}) {
  return render(
    <HomeFeedList
      blocks={GRID_BLOCKS}
      primaryProductGridIndex={1}
      selectedCategoryId={null}
      onCategorySelect={jest.fn()}
      onScroll={
        jest.fn() as unknown as Parameters<typeof HomeFeedList>[0]['onScroll']
      }
      isSearchOpen={false}
      refreshing={false}
      onRefresh={jest.fn()}
      primaryColor="#ff0000"
      resolvedHeaderHeight={120}
      contentBottomPadding={24}
      {...props}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseHomeProductFeed.mockReturnValue(feed());
});

describe('HomeFeedList pagination layout', () => {
  it('keeps grid gutters on product cells instead of padding the whole feed', () => {
    renderList();

    expect(
      screen.getByTestId('home-feed-list').props.contentContainerStyle
    ).toEqual({
      paddingBottom: 24,
    });
  });

  it('triggers loadMore from a product-end sentinel before footer blocks render as the list end', () => {
    const loadMore = jest.fn();
    mockUseHomeProductFeed.mockReturnValue(feed({ loadMore, hasMore: true }));
    renderList({
      blocks: [
        ...GRID_BLOCKS,
        { type: 'CategoryRail', props: { id: 'footer-rail' } },
      ] as unknown as Block[],
    });

    screen.getByTestId('home-feed-product-end-sentinel').props.onLayout();

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('preserves service cards after category rails rendered in the footer', () => {
    renderList({
      blocks: [
        ...GRID_BLOCKS,
        { type: 'CategoryRail', props: { id: 'footer-rail' } },
      ] as unknown as Block[],
    });

    expect(screen.getAllByTestId('home-service-cards')).toHaveLength(2);
  });
});
