import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import SearchScreenView from './SearchScreenView';

jest.mock('@/components/storefront/FilterBar', () => ({
  FilterBar: function MockFilterBar() {
    return null;
  },
}));

jest.mock('@/components/storefront/ProductCard', () => ({
  ProductCard: function MockProductCard() {
    return null;
  },
}));

jest.mock('@shopify/flash-list', () => {
  const { Pressable, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  const React = jest.requireActual('react') as typeof import('react');

  return {
    FlashList: function MockFlashList({
      ListFooterComponent,
      ListHeaderComponent,
      data,
      onEndReached,
      renderItem,
    }: {
      ListFooterComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      data: Array<{ id: string }>;
      onEndReached?: () => void;
      renderItem?: (info: {
        item: { id: string };
        index: number;
      }) => React.ReactNode;
    }) {
      return (
        <View testID="mock-flash-list">
          {ListHeaderComponent}
          {data.map((item, index) => (
            <View key={item.id} testID={`mock-flash-item-${item.id}`}>
              {renderItem?.({ item, index })}
            </View>
          ))}
          {ListFooterComponent}
          <Pressable testID="mock-flash-end-reached" onPress={onEndReached}>
            <Text>End reached</Text>
          </Pressable>
        </View>
      );
    },
  };
});

const categories: Category[] = [
  { id: 'phones', name: 'Phones', slug: 'phones' },
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

  return { props, ...render(<SearchScreenView {...props} />) };
}

describe('SearchScreenView', () => {
  it('supports search header actions without automatically focusing input', () => {
    const onBack = jest.fn();
    const onClearQuery = jest.fn();
    const onQueryChange = jest.fn();
    const onSubmitQuery = jest.fn();

    renderView({
      onBack,
      onClearQuery,
      onQueryChange,
      onSubmitQuery,
      query: 'phone',
    });

    const input = screen.getByLabelText('Search products');
    expect(input.props.autoFocus).toBeFalsy();
    fireEvent.changeText(input, 'laptop');
    fireEvent(input, 'submitEditing');
    fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(onQueryChange).toHaveBeenCalledWith('laptop');
    expect(onSubmitQuery).toHaveBeenCalledTimes(1);
    expect(onClearQuery).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders recent searches and popular categories as actions', () => {
    const onCategoryPress = jest.fn();
    const onRecentSearch = jest.fn();

    renderView({ onCategoryPress, onRecentSearch });

    fireEvent.press(
      screen.getByRole('button', { name: 'Recent search: iPhone 15 Pro' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Category: Phones' }));

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

  it('shows a truthful loaded count and appends pages at the list end', () => {
    const onEndReached = jest.fn();
    const products = [
      { id: 'product-1', name: 'iPhone 16' },
      { id: 'product-2', name: 'iPhone 15' },
    ] as Product[];

    renderView({
      committedQuery: 'iphone',
      hasSearchQuery: true,
      onEndReached,
      products,
      query: 'iphone',
      totalCount: 45,
    });

    expect(
      screen.getByText('Showing 2 of 45 results for “iphone”')
    ).toBeTruthy();
    expect(screen.getByTestId('mock-flash-list')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mock-flash-end-reached'));
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('shows the total once every match is loaded', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderView({
      committedQuery: 'iphone 16',
      hasSearchQuery: true,
      products,
      query: 'iphone 16',
      totalCount: 1,
    });

    expect(screen.getByText('1 result for “iphone 16”')).toBeTruthy();
  });

  it('shows a loading footer while more results append', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderView({
      committedQuery: 'iphone',
      hasSearchQuery: true,
      isLoadingMore: true,
      products,
      query: 'iphone',
      totalCount: 45,
    });

    expect(screen.getByText('Loading more…')).toBeTruthy();
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

  it('names the submitted query and category paths on zero matches', () => {
    const onCategoryPress = jest.fn();

    renderView({
      committedQuery: 'zzzz',
      hasSearchQuery: true,
      onCategoryPress,
      query: 'zzzz',
    });

    expect(screen.getByText('No results found')).toBeTruthy();
    expect(
      screen.getByText(
        'No products match “zzzz”. Try a different spelling or browse a category.'
      )
    ).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Browse Phones' }));
    expect(onCategoryPress).toHaveBeenCalledWith('phones');
  });
});
