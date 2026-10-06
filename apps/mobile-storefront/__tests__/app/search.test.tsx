let mockFocused = true;

import { act, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type SearchScreenView from '@/components/search/SearchScreenView';
import type { Product } from '@/types/product';
import SearchScreen from '../../app/search';

type SearchScreenViewProps = ComponentProps<typeof SearchScreenView>;

const mockUseLocalSearchParams = jest.fn();
const mockUseProducts = jest.fn();
const mockUseSearchFacets = jest.fn();
const mockUseCategories = jest.fn();
const mockViewProps: { current: SearchScreenViewProps | null } = {
  current: null,
};
const mockStorageData: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
  useProducts: (args: unknown) => mockUseProducts(args),
}));

jest.mock('@/hooks/use-search-facet-options', () => ({
  useSearchFacetOptions: (query: string, enabled: boolean) =>
    mockUseSearchFacets(query, enabled),
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => ({ data: { id: 'merchant-1' } }),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn((key: string) => mockStorageData[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      mockStorageData[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete mockStorageData[key];
    }),
  },
}));

jest.mock('@/components/search/SearchScreenView', () => ({
  __esModule: true,
  default: (props: SearchScreenViewProps) => {
    mockViewProps.current = props;
    return null;
  },
}));

function mockProductState(overrides: Record<string, unknown> = {}) {
  return {
    products: [],
    total: 0,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: jest.fn(),
    refetch: jest.fn(),
    error: null,
    ...overrides,
  };
}

describe('SearchScreen route', () => {
  beforeEach(() => {
    mockFocused = true;
    jest.clearAllMocks();
    jest.useFakeTimers();
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
    mockViewProps.current = null;
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseProducts.mockReturnValue(mockProductState());
    mockUseSearchFacets.mockReturnValue({
      data: { brands: [], categories: [], conditions: [] },
      error: null,
      refetch: jest.fn(),
    });
    mockUseCategories.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('cancels typing commits when navigating to a product or blurring', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone', brand: ['Apple'] });
    const { rerender } = render(<SearchScreen />);
    act(() => mockViewProps.current?.onQueryChange('laptop'));
    mockFocused = false;
    rerender(<SearchScreen />);
    act(() => jest.advanceTimersByTime(300));
    expect(mockViewProps.current?.committedQuery).toBe('iphone');
    expect(mockViewProps.current?.refinements?.brands).toEqual(['Apple']);
  });
  it('initializes from the route query and saves history once', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });

    render(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: 'iphone',
      committedQuery: 'iphone',
      hasSearchQuery: true,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'iphone', enabled: true })
    );

    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { setItem: jest.Mock };
    };
    expect(syncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(syncStorage.setItem).toHaveBeenCalledWith(
      'search_history',
      expect.stringContaining('iphone')
    );
  });

  it('stays idle for short or repeated route params without fetching', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'i' });

    const { rerender } = render(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: '',
      hasSearchQuery: false,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );

    mockUseLocalSearchParams.mockReturnValue({ q: ['iphone', 'galaxy'] });
    rerender(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({ hasSearchQuery: false });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );

    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { setItem: jest.Mock };
    };
    expect(syncStorage.setItem).not.toHaveBeenCalled();
  });

  it('stays idle for route params that normalize to nothing', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: '!!' });

    render(<SearchScreen />);

    // Passes the length check but the fetch would resolve it to zero
    // matches: treat the deep link as invalid instead of presenting a
    // misleading no-results journey.
    expect(mockViewProps.current).toMatchObject({
      query: '',
      hasSearchQuery: false,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );
  });

  it('applies a new route query on a mounted screen without clobbering later edits', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });

    const { rerender } = render(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({ query: 'iphone' });

    mockUseLocalSearchParams.mockReturnValue({ q: 'galaxy' });
    rerender(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({
      query: 'galaxy',
      committedQuery: 'galaxy',
    });

    // Typing after the navigation commits through the normal debounce path
    // instead of being overwritten by the route effect.
    act(() => {
      mockViewProps.current?.onQueryChange('pixel');
    });
    expect(mockViewProps.current).toMatchObject({ query: 'pixel' });

    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(mockViewProps.current).toMatchObject({
      query: 'pixel',
      committedQuery: 'pixel',
    });
  });

  it('clears stale results when the route query becomes invalid', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });

    const { rerender } = render(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({
      query: 'iphone',
      hasSearchQuery: true,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'iphone', enabled: true })
    );

    mockUseLocalSearchParams.mockReturnValue({});
    rerender(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: '',
      committedQuery: '',
      hasSearchQuery: false,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );
  });

  it('clears the validation hint when a valid recent search is selected', () => {
    render(<SearchScreen />);

    // Reject a normalization-empty commit so the hint explains itself.
    act(() => {
      mockViewProps.current?.onQueryChange('!!');
    });
    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    expect(mockViewProps.current).toMatchObject({ showMinLengthHint: true });

    // Selecting a valid recent term resolves that rejection: the hint must
    // clear instead of lingering over the incoming valid results.
    act(() => {
      mockViewProps.current?.onRecentSearch('iPhone 15 Pro');
    });
    expect(mockViewProps.current).toMatchObject({
      query: 'iPhone 15 Pro',
      showMinLengthHint: false,
    });
  });

  it('clears a local search when an invalid route query arrives on a parameterless screen', () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const { rerender } = render(<SearchScreen />);

    // A locally entered and committed search with no route query behind it.
    act(() => {
      mockViewProps.current?.onQueryChange('shoes');
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(mockViewProps.current).toMatchObject({
      query: 'shoes',
      committedQuery: 'shoes',
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'shoes', enabled: true })
    );

    // A deep-link update to a short (invalid) query must clear the local
    // search even though no route query was ever applied.
    mockUseLocalSearchParams.mockReturnValue({ q: 'i' });
    rerender(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: '',
      committedQuery: '',
      hasSearchQuery: false,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );

    // Same for a repeated (ambiguous) param after searching locally again.
    act(() => {
      mockViewProps.current?.onQueryChange('shoes');
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(mockViewProps.current).toMatchObject({ committedQuery: 'shoes' });

    mockUseLocalSearchParams.mockReturnValue({ q: ['shoes', 'bags'] });
    rerender(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: '',
      committedQuery: '',
      hasSearchQuery: false,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );
  });

  it('navigates with exact match ids and omits the snapshot condition', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    render(<SearchScreen />);
    const { router } = jest.requireMock('expo-router') as {
      router: { push: jest.Mock };
    };

    act(() =>
      mockViewProps.current?.onProductPress({
        slug: 'iphone-13',
        searchMatch: {
          productId: 'p1',
          total: 1,
          offerId: 'o1',
          condition: 'used',
        },
      } as Product)
    );

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'iphone-13', offer_id: 'o1' },
    });
  });

  it('forwards a condition-only match without an exact id', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    render(<SearchScreen />);
    const { router } = jest.requireMock('expo-router') as {
      router: { push: jest.Mock };
    };

    act(() =>
      mockViewProps.current?.onProductPress({
        slug: 'iphone-13',
        searchMatch: { productId: 'p1', total: 1, condition: 'used' },
      } as Product)
    );

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'iphone-13', condition: 'used' },
    });
  });
});
