import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { Block } from '@/types/blocks';
import {
  feed,
  GRID_BLOCKS,
  mockBlockRendererModule,
  mockFlashListModule,
  mockScrollToOffset,
  mockUseHomeProductFeed,
  product,
  setupHomeFeedMocks,
} from './HomeFeedList-test-harness';

jest.mock('@shopify/flash-list', () => mockFlashListModule());

jest.mock('./use-home-product-feed', () => ({
  useHomeProductFeed: jest.fn(),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#000000' } }),
}));

jest.mock('@/components/storefront/BlockRenderer', () =>
  mockBlockRendererModule()
);

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
    ProductCard: ({ product }: { product: { id: string } }) => (
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

import { HomeFeedList } from './HomeFeedList';

beforeEach(() => {
  setupHomeFeedMocks();
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
