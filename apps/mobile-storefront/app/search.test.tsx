import { fireEvent, render, screen } from '@testing-library/react-native';
import SearchScreen from './search';

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    push: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => ({ data: [] }),
  useProductBrands: () => ({ brands: [] }),
  useProducts: () => ({
    error: null,
    hasMore: false,
    isFetching: false,
    isLoading: false,
    isLoadingMore: false,
    isNextPageError: null,
    loadMore: jest.fn(),
    products: [],
    refetch: jest.fn(),
    total: 0,
  }),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));

const mockStorageData: Record<string, string> = {};

jest.mock('@/lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn((key: string) => mockStorageData[key] ?? null),
    removeItem: jest.fn((key: string) => {
      delete mockStorageData[key];
    }),
    setItem: jest.fn((key: string, value: string) => {
      mockStorageData[key] = value;
    }),
  },
}));

describe('SearchScreen route', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
    jest.clearAllMocks();
  });

  it('clears the validation hint when a valid recent search is selected', () => {
    render(<SearchScreen />);

    // Reject a normalization-empty commit so the hint explains itself.
    const input = screen.getByPlaceholderText('Search products...');
    fireEvent.changeText(input, '!!');
    fireEvent(input, 'submitEditing');
    expect(
      screen.getByLabelText('Type letters or numbers to search')
    ).toBeTruthy();

    // Selecting a valid recent term resolves that rejection: the hint must
    // clear instead of lingering over the incoming valid results (in any
    // copy — the label follows the current input, so check both).
    fireEvent.press(screen.getByText('iPhone 15 Pro'));
    expect(
      screen.queryByLabelText('Type letters or numbers to search')
    ).toBeNull();
    expect(
      screen.queryByLabelText('Type at least 2 characters to search')
    ).toBeNull();
  });
});
