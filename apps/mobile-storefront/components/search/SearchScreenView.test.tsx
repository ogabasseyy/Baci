import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import SearchScreenView from './SearchScreenView';

jest.mock('./SearchResultsEmptyState', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./SearchResultsList', () => {
  const { Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: function MockSearchResultsList({
      listError,
    }: {
      listError?: string | null;
    }) {
      return (
        <View testID="mock-results-list">
          <Text>{listError ?? 'no-list-error'}</Text>
        </View>
      );
    },
  };
});

const categories: Category[] = [
  { id: 'cat-1', name: 'Phones', slug: 'phones' },
];

function renderView(
  overrides: Partial<ComponentProps<typeof SearchScreenView>> = {}
) {
  const props: ComponentProps<typeof SearchScreenView> = {
    brandNames: [],
    categories,
    categoryNames: ['All', 'Phones'],
    colors: Colors.light,
    committedQuery: '',
    hasSearchQuery: false,
    isLoading: false,
    isLoadingMore: false,
    isOnline: true,
    maxPrice: 0,
    minPrice: 0,
    minRating: 0,
    onBack: jest.fn(),
    onCategoryPress: jest.fn(),
    onCategorySelect: jest.fn(),
    onClearQuery: jest.fn(),
    onEndReached: jest.fn(),
    onPriceChange: jest.fn(),
    onProductPress: jest.fn(),
    onQueryChange: jest.fn(),
    onRecentSearch: jest.fn(),
    onRetry: jest.fn(),
    onRetryNextPage: jest.fn(),
    onSelectBrand: jest.fn(),
    onSelectCondition: jest.fn(),
    onSelectRating: jest.fn(),
    onSubmitQuery: jest.fn(),
    onViewModeChange: jest.fn(),
    products: [],
    query: '',
    recentSearches: ['iPhone 15 Pro'],
    searchError: null,
    selectedBrand: 'All',
    selectedCategory: 'All',
    selectedCondition: 'All',
    totalCount: 0,
    viewMode: 'grid',
    ...overrides,
  };

  return render(<SearchScreenView {...props} />);
}

describe('SearchScreenView', () => {
  it('renders recent searches and categories when idle', () => {
    const onRecentSearch = jest.fn();
    const onCategoryPress = jest.fn();

    renderView({ onRecentSearch, onCategoryPress });

    fireEvent.press(screen.getByText('iPhone 15 Pro'));
    fireEvent.press(screen.getByText('Phones'));

    expect(onRecentSearch).toHaveBeenCalledWith('iPhone 15 Pro');
    expect(onCategoryPress).toHaveBeenCalledWith('phones');
  });

  it('renders an offline state while a query cannot be fetched', () => {
    renderView({ hasSearchQuery: true, isOnline: false, query: 'phone' });

    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(
      screen.getByText('Connect to the internet to search products')
    ).toBeTruthy();
  });

  it('renders a retryable error state instead of no-results copy', () => {
    const onRetry = jest.fn();

    renderView({
      committedQuery: 'iphone',
      hasSearchQuery: true,
      onRetry,
      query: 'iphone',
      searchError: 'Search failed',
    });

    expect(screen.getByText("Couldn't load results")).toBeTruthy();
    expect(screen.queryByText('No results found')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded products visible when the next page fails', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderView({
      committedQuery: 'iphone',
      hasSearchQuery: true,
      products,
      query: 'iphone',
      searchError: 'Search failed',
      totalCount: 45,
    });

    expect(screen.queryByText("Couldn't load results")).toBeNull();
    expect(screen.getByTestId('mock-results-list')).toBeTruthy();
    expect(screen.getByText('Search failed')).toBeTruthy();
  });
});
