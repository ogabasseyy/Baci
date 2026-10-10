import { act, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type SearchScreenView from '@/components/search/SearchScreenView';
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
  useIsFocused: () => true,
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

  it('guards the list end event against duplicate fetches', () => {
    const loadMore = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({ hasMore: true, loadMore })
    );

    const { rerender } = render(<SearchScreen />);

    act(() => {
      mockViewProps.current?.onEndReached();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    mockUseProducts.mockReturnValue(
      mockProductState({ hasMore: true, isLoadingMore: true, loadMore })
    );
    rerender(<SearchScreen />);

    act(() => {
      mockViewProps.current?.onEndReached();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('blocks pagination while a background refresh error stands', () => {
    const loadMore = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({
        error: 'Search failed',
        hasMore: true,
        isNextPageError: false,
        loadMore,
        products: [{ id: 'product-1', name: 'iPhone 16' }],
      })
    );

    render(<SearchScreen />);

    // The footer appearing can itself emit an end event: it must not
    // append a page that would clear the refresh error behind stale data.
    act(() => {
      mockViewProps.current?.onEndReached();
    });
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('blocks pagination while a next-page error stands', () => {
    const loadMore = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({
        error: 'Search failed',
        hasMore: true,
        isNextPageError: true,
        loadMore,
        products: [{ id: 'product-1', name: 'iPhone 16' }],
      })
    );

    render(<SearchScreen />);

    // The error footer appearing can itself emit an end event: it must
    // not fire an automatic retry behind the explicit footer action.
    act(() => {
      mockViewProps.current?.onEndReached();
    });
    expect(loadMore).not.toHaveBeenCalled();

    // Recovery stays available through the explicit footer retry.
    act(() => {
      mockViewProps.current?.onRetryNextPage();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
