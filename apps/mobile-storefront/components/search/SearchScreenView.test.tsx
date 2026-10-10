import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
} from 'react-native';

const mockResultsEvents: {
  bottomSpace?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} = {};

import Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import SearchScreenView from './SearchScreenView';

const mockKeyboard = {
  isKeyboardVisible: false,
  keyboardTop: null as number | null,
  keyboardHeight: 0,
  dismissKeyboard: jest.fn(),
};
jest.mock('@/hooks/use-keyboard', () => ({ useKeyboard: () => mockKeyboard }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
afterEach(() => {
  mockKeyboard.isKeyboardVisible = false;
  mockKeyboard.keyboardTop = null;
  mockKeyboard.keyboardHeight = 0;
});

jest.mock('./SearchScreenTopBar', () => ({
  SearchScreenTopBar: ({
    showComparison,
    onBack,
  }: {
    showComparison: boolean;
    onBack: () => void;
  }) => {
    const { Text, View, Pressable } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
        >
          <Text>Back</Text>
        </Pressable>
        <Text testID="comparison-navigation">
          {showComparison ? 'available' : 'hidden'}
        </Text>
      </View>
    );
  },
}));

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
      bottomSpace,
      resultsKey,
      onScroll,
    }: {
      bottomSpace?: number;
      onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
      listError?: string | null;
      resultsKey?: string;
    }) {
      mockResultsEvents.onScroll = onScroll;
      mockResultsEvents.bottomSpace = bottomSpace;
      return (
        <View testID="mock-results-list">
          <Text>{listError ?? 'no-list-error'}</Text>
          <Text testID="mock-results-key">{resultsKey ?? 'no-key'}</Text>
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
    hasMore: false,
    hasSearchQuery: false,
    isLoading: false,
    isLoadingMore: false,
    isNextPageError: false,
    isOnline: true,
    isRetrying: false,
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
    expect(screen.getByTestId('comparison-navigation').props.children).toBe(
      'available'
    );
  });

  it('keeps comparison navigation when a refinement returns zero rows', () => {
    renderView({
      committedQuery: 'iphone',
      hasSearchQuery: true,
      products: [],
      query: 'iphone',
      totalCount: 0,
    });

    // Selection count and session intent gate the action itself; an empty
    // page must not remove the route to an active comparison.
    expect(screen.getByTestId('comparison-navigation').props.children).toBe(
      'available'
    );
  });

  it('rekeys the results list when the committed query changes', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];
    const base = {
      hasSearchQuery: true,
      products,
      totalCount: 1,
    };

    const first = renderView({ ...base, committedQuery: 'iphone' });
    const iphoneKey = screen.getByTestId('mock-results-key').props.children;
    expect(iphoneKey).toContain('iphone');
    first.unmount();

    // A new committed query remounts the list at the top instead of
    // inheriting the previous query's scroll offset.
    renderView({ ...base, committedQuery: 'galaxy' });
    const galaxyKey = screen.getByTestId('mock-results-key').props.children;
    expect(galaxyKey).not.toBe(iphoneKey);
    expect(galaxyKey).toContain('galaxy');
  });

  it('rekeys the results list when a refinement changes', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];
    const base = {
      committedQuery: 'iphone',
      hasSearchQuery: true,
      products,
      totalCount: 1,
    };

    const first = renderView(base);
    const unrefinedKey = screen.getByTestId('mock-results-key').props.children;
    first.unmount();

    renderView({ ...base, selectedBrand: 'Apple' });
    const refinedKey = screen.getByTestId('mock-results-key').props.children;
    expect(refinedKey).not.toBe(unrefinedKey);
    expect(refinedKey).toContain('Apple');
  });

  it('keeps the results list identity stable for the same result set', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];
    const base = {
      committedQuery: 'iphone',
      hasSearchQuery: true,
      products,
      totalCount: 1,
    };

    const first = renderView(base);
    const beforeKey = screen.getByTestId('mock-results-key').props.children;
    first.unmount();

    // Returning from a product re-renders the same query and refinements:
    // the identity (and scroll position) must not reset.
    renderView(base);
    expect(screen.getByTestId('mock-results-key').props.children).toBe(
      beforeKey
    );
  });
});
