import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { Block } from '@/types/blocks';
import {
  feed,
  GRID_BLOCKS,
  mockBlockRenderer,
  mockBlockRendererModule,
  mockFlashListModule,
  mockUseHomeProductFeed,
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

describe('HomeFeedList ad slots', () => {
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

  it('grants the hero placement once when slices share a duplicate block id', () => {
    // Regression: the CMS schema does not enforce unique IDs, so a
    // header hero and a footer hero may share one; electing and granting
    // on the bare ID would let both slices claim HOME_STRIP concurrently.
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
        hero('hero'),
        { type: 'ProductGrid', props: { id: 'grid' } },
        hero('hero'),
      ] as unknown as Block[],
      primaryProductGridIndex: 1,
    });

    const calls = mockBlockRenderer.mock.calls.map(
      (call) =>
        call[0] as {
          blocks: Block[];
          heroAdOwnerBlockId?: string | null;
        }
    );
    expect(calls.map((props) => props.heroAdOwnerBlockId)).toEqual([
      'hero',
      'hero',
    ]);
    // Each slice sees page-unique IDs, so only the header hero matches
    // the elected owner while the footer duplicate is withheld.
    expect(
      calls.map((props) => props.blocks.map((block) => block.props.id))
    ).toEqual([['hero'], ['hero#__2']]);
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

  it('withholds the in-feed slot when the feed resolves empty', () => {
    // Regression: a successful query or active filter can return zero
    // products — the placement must not request below the empty state.
    mockUseHomeProductFeed.mockReturnValue(feed({ feedProducts: [] }));
    renderList();
    expect(screen.queryByTestId('ad-slot-PRODUCT_GRID_IN_FEED')).toBeNull();
  });
});
