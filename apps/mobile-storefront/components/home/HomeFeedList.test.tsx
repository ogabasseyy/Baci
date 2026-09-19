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
});

jest.mock('./use-home-product-feed', () => ({
  useHomeProductFeed: jest.fn(),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#000000' } }),
}));

const mockBlockRenderer = jest.fn();

jest.mock('@/components/storefront/BlockRenderer', () => {
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
});

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
  { type: 'ProductGrid', props: { id: 'grid', title: 'Shop the collection' } },
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

describe('HomeFeedList', () => {
  it('renders the FilterBar, section title, and a cell per product when a grid exists', () => {
    renderList();

    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    expect(screen.getByText('Shop the collection')).toBeTruthy();
    expect(screen.getAllByTestId('product-card')).toHaveLength(2);
  });

  it('renders products for a single-column (list) variant', () => {
    mockUseHomeProductFeed.mockReturnValue(feed({ currentVariant: 'list' }));
    renderList();

    expect(screen.getAllByTestId('product-card')).toHaveLength(2);
  });

  it('fires loadMore on onEndReached', () => {
    const loadMore = jest.fn();
    mockUseHomeProductFeed.mockReturnValue(feed({ loadMore }));
    renderList();

    screen.getByTestId('home-feed-list').props.onEndReached();

    expect(loadMore).toHaveBeenCalled();
  });

  it('does not fire loadMore on onEndReached while the search overlay is open', () => {
    const loadMore = jest.fn();
    mockUseHomeProductFeed.mockReturnValue(feed({ loadMore }));
    renderList({ isSearchOpen: true });

    screen.getByTestId('home-feed-list').props.onEndReached();

    expect(loadMore).not.toHaveBeenCalled();
  });

  it('renders home ad placements while the search overlay is closed', () => {
    renderList({ isSearchOpen: false });

    expect(screen.getAllByTestId('block-renderer')).toHaveLength(2);
    expect(screen.getByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeTruthy();
  });

  it('elects one hero ad owner across the header and footer slices', () => {
    // Regression: each slice renders its own BlockRenderer, so per-slice
    // elections would let a header hero and a footer hero each claim
    // HOME_STRIP and request it concurrently.
    const hero = (id: string) =>
      ({
        type: 'HeroCarousel',
        props: {
          id,
          slides: [
            {
              ctaLink: `/deals/${id}`,
              ctaText: 'Shop',
              image: `https://example.com/${id}.jpg`,
              subtitle: 'Available now',
              title: id,
            },
          ],
        },
      }) as unknown as Block;
    renderList({
      blocks: [
        hero('header-hero'),
        { type: 'ProductGrid', props: { id: 'grid' } },
        hero('footer-hero'),
      ] as unknown as Block[],
      primaryProductGridIndex: 1,
    });

    const owners = mockBlockRenderer.mock.calls.map(
      (call) =>
        (call[0] as { heroAdOwnerBlockId?: string | null }).heroAdOwnerBlockId
    );
    expect(owners).toEqual(['header-hero', 'header-hero']);
  });

  it('suppresses home ad placements while the search overlay is open', () => {
    // Regression: search covers the feed with a full-screen scrim, so the
    // block placements and the in-feed slot must unmount while it is open.
    renderList({ isSearchOpen: true });

    expect(screen.getAllByTestId('block-renderer-ads-off')).toHaveLength(2);
    expect(screen.queryByTestId('block-renderer')).toBeNull();
    expect(screen.queryByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeNull();
  });

  it('withholds the in-feed slot when the page has no product grid', () => {
    // Regression: a page configured without a ProductGrid intentionally
    // renders only authored blocks, so the grid placement must not request
    // with no product feed behind it.
    renderList({ primaryProductGridIndex: -1 });
    expect(screen.queryByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeNull();
  });

  it('withholds the in-feed slot while loading or fatally errored', () => {
    // Regression: the footer renders alongside the empty state, so the
    // placement must not request below a skeleton or retry error with no
    // successfully resolved product feed.
    mockUseHomeProductFeed.mockReturnValue(
      feed({ feedProducts: [], shouldShowInitialLoading: true })
    );
    const { unmount } = renderList();
    expect(screen.queryByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeNull();
    unmount();

    mockUseHomeProductFeed.mockReturnValue(
      feed({ feedProducts: [], shouldShowFatalError: true })
    );
    renderList();
    expect(screen.queryByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeNull();
  });

  it('builds a RefreshControl with the header offset and theme color', () => {
    const onRefresh = jest.fn();
    renderList({ onRefresh });

    const { refreshControl } = screen.getByTestId('home-feed-list').props;
    expect(refreshControl.props.onRefresh).toBe(onRefresh);
    expect(refreshControl.props.progressViewOffset).toBe(120);
    expect(refreshControl.props.tintColor).toBe('#ff0000');
  });

  it('renders the load-more progressbar with an accessible label', () => {
    mockUseHomeProductFeed.mockReturnValue(feed({ isLoadingMore: true }));
    renderList();

    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('renders the error+retry empty state on a fatal error', () => {
    mockUseHomeProductFeed.mockReturnValue(
      feed({ feedProducts: [], shouldShowFatalError: true })
    );
    renderList();

    expect(screen.getByTestId('home-feed-error')).toBeTruthy();
  });

  it('omits cached product cells and grid-only UI when there is no primary grid', () => {
    mockUseHomeProductFeed.mockReturnValue(
      feed({ feedProducts: [product('stale')] })
    );
    renderList({
      blocks: [{ type: 'CategoryRail', props: { id: 'rail' } }] as Block[],
      primaryProductGridIndex: -1,
    });

    expect(screen.queryByTestId('filter-bar')).toBeNull();
    expect(screen.queryByTestId('product-card')).toBeNull();
    expect(screen.queryByTestId('home-feed-product-end-sentinel')).toBeNull();
    expect(screen.queryByTestId('home-feed-empty')).toBeNull();
    expect(screen.queryByTestId('home-feed-error')).toBeNull();
  });

  it('scrolls to top when the feed reset key changes', () => {
    const { rerender } = renderList();
    expect(mockScrollToOffset).toHaveBeenCalledTimes(1);

    mockUseHomeProductFeed.mockReturnValue(feed({ feedResetKey: 'reset-2' }));
    rerender(
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
      />
    );

    expect(mockScrollToOffset).toHaveBeenCalledWith({
      offset: 0,
      animated: false,
    });
    expect(mockScrollToOffset).toHaveBeenCalledTimes(2);
  });
});
