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

  it('forwards the fetching flag so the error state shows a pending retry', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({ error: 'Search failed', isFetching: true })
    );

    render(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({ isRetrying: true });
  });

  it('forwards the next-page error flag so the footer routes its retry', () => {
    mockUseLocalSearchParams.mockReturnValue({ q: 'iphone' });
    mockUseProducts.mockReturnValue(
      mockProductState({ error: 'Search failed', isNextPageError: true })
    );

    const { rerender } = render(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({ isNextPageError: true });

    mockUseProducts.mockReturnValue(
      mockProductState({ error: 'Search failed', isNextPageError: false })
    );
    rerender(<SearchScreen />);
    expect(mockViewProps.current).toMatchObject({ isNextPageError: false });
  });
});
