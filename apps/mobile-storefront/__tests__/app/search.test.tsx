import { act, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type SearchScreenView from '@/components/search/SearchScreenView';
import SearchScreen from '../../app/search';

type SearchScreenViewProps = ComponentProps<typeof SearchScreenView>;

const mockUseLocalSearchParams = jest.fn();
const mockUseProducts = jest.fn();
const mockUseProductBrands = jest.fn();
const mockUseCategories = jest.fn();
const mockViewProps: { current: SearchScreenViewProps | null } = {
  current: null,
};
const mockStorageData: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
  useProductBrands: () => mockUseProductBrands(),
  useProducts: (args: unknown) => mockUseProducts(args),
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
    mockUseProductBrands.mockReturnValue({ brands: [] });
    mockUseCategories.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
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

  it('surfaces search errors with a retry path', () => {
    const refetch = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({ error: 'Search failed', refetch })
    );

    render(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      searchError: 'Search failed',
    });

    act(() => {
      mockViewProps.current?.onRetry();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
