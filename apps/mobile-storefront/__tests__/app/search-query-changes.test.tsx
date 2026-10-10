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

  it('resets refinements when a new route query arrives on a mounted screen', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseSearchFacets.mockReturnValue({
      data: { brands: ['Apple'], categories: [], conditions: ['used'] },
      error: null,
      refetch: jest.fn(),
    });

    const { rerender } = render(<SearchScreen />);
    expect(mockViewProps.current?.availableConditions).toEqual(['used']);
    expect(mockViewProps.current?.filterCategories).toEqual([]);
    expect(mockUseSearchFacets).toHaveBeenCalledWith('iphone', true);

    act(() => {
      mockViewProps.current?.onRefinementsChange?.({
        brands: ['Apple'],
        condition: 'new',
        sort: 'relevance',
        minRating: 4,
        minPrice: 100,
        maxPrice: 500,
      });
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: 'iphone',
        brand: 'Apple',
        condition: 'new',
        minPrice: 100,
        maxPrice: 500,
        minRating: 4,
      })
    );

    mockUseLocalSearchParams.mockReturnValue({ q: 'galaxy' });
    rerender(<SearchScreen />);

    expect(mockViewProps.current).toMatchObject({
      query: 'galaxy',
      committedQuery: 'galaxy',
      selectedCategory: 'All',
      selectedBrand: 'All',
      selectedCondition: 'All',
      minPrice: 0,
      maxPrice: 0,
      minRating: 0,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: 'galaxy',
        brand: undefined,
        condition: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        minRating: undefined,
      })
    );
  });

  it('bounds an over-long pasted query at acceptance on the results screen', () => {
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseProducts.mockReturnValue(mockProductState());

    render(<SearchScreen />);

    const boundedQuery = 'a'.repeat(100);
    act(() => {
      mockViewProps.current?.onQueryChange('a'.repeat(150));
    });

    // The controlled state itself is capped, so the debounced auto-commit,
    // history, and the search RPC never see the excess.
    expect(mockViewProps.current).toMatchObject({ query: boundedQuery });

    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(mockViewProps.current).toMatchObject({
      committedQuery: boundedQuery,
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: boundedQuery, enabled: true })
    );

    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { setItem: jest.Mock };
    };
    expect(syncStorage.setItem).toHaveBeenCalledWith(
      'search_history',
      expect.stringContaining(boundedQuery)
    );
    expect(syncStorage.setItem).not.toHaveBeenCalledWith(
      'search_history',
      expect.stringContaining('a'.repeat(150))
    );
  });

  it('leaves punctuation-only commits idle instead of searching', () => {
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseProducts.mockReturnValue(mockProductState());

    render(<SearchScreen />);

    act(() => {
      mockViewProps.current?.onQueryChange('!!');
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    // Passes the length check but normalizes to nothing: no committed
    // search, no fetch, no history entry — the idle screen stays.
    expect(mockViewProps.current).toMatchObject({
      query: '!!',
      committedQuery: '',
    });
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, enabled: false })
    );

    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { setItem: jest.Mock };
    };
    expect(syncStorage.setItem).not.toHaveBeenCalledWith(
      'search_history',
      expect.stringContaining('!!')
    );
    expect(mockViewProps.current).toMatchObject({ committedQuery: '' });
  });

  it('explains rejected commits with a hint until the input is searchable', () => {
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseProducts.mockReturnValue(mockProductState());

    render(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({
      showMinLengthHint: false,
    });

    act(() => {
      mockViewProps.current?.onQueryChange('!!');
    });
    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    expect(mockViewProps.current).toMatchObject({ showMinLengthHint: true });

    // Editing toward a searchable query clears the explanation.
    act(() => {
      mockViewProps.current?.onQueryChange('!!a');
    });
    expect(mockViewProps.current).toMatchObject({
      showMinLengthHint: false,
    });

    // A valid commit clears it too.
    act(() => {
      mockViewProps.current?.onQueryChange('!!');
    });
    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    expect(mockViewProps.current).toMatchObject({ showMinLengthHint: true });
    act(() => {
      mockViewProps.current?.onQueryChange('iphone');
    });
    act(() => {
      mockViewProps.current?.onSubmitQuery();
    });
    expect(mockViewProps.current).toMatchObject({
      showMinLengthHint: false,
    });
  });
});
