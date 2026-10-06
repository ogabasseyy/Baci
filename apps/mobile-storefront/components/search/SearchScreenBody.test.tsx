import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { ScrollView } from 'react-native';
import Colors from '@/constants/Colors';
import type { Category, Product } from '@/types/product';
import SearchScreenBody from './SearchScreenBody';

jest.mock('./SearchResultsEmptyState', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./SearchResultsList', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: () => <View testID="mock-results-list" />,
  };
});

jest.mock('./SearchLoadingCards', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: () => <View testID="mock-loading-cards" />,
  };
});

const categories: Category[] = [
  { id: 'cat-1', name: 'Phones', slug: 'phones' },
];
const products: Product[] = [
  { id: 'p1', slug: 'p1', name: 'Phone One', price: 100, image: '' },
];

function renderBody(
  overrides: Partial<ComponentProps<typeof SearchScreenBody>> = {}
) {
  const props: ComponentProps<typeof SearchScreenBody> = {
    bottomSpace: 100,
    categories,
    colors: Colors.light,
    committedQuery: 'phone',
    hasMore: false,
    hasSearchQuery: true,
    insetsBottom: 34,
    isKeyboardVisible: false,
    isLoading: false,
    isLoadingMore: false,
    isNextPageError: false,
    isOnline: true,
    isRetrying: false,
    keyboardHeight: 0,
    onCategoryPress: jest.fn(),
    onEndReached: jest.fn(),
    onProductPress: jest.fn(),
    onRecentSearch: jest.fn(),
    onRetry: jest.fn(),
    onRetryNextPage: jest.fn(),
    onScroll: jest.fn(),
    products,
    recentSearches: ['iphone'],
    resultsKey: 'key',
    searchError: null,
    totalCount: 1,
    ...overrides,
  };
  return render(<SearchScreenBody {...props} />);
}

describe('SearchScreenBody', () => {
  it('shows recent searches and categories before any search', () => {
    const onRecentSearch = jest.fn();
    renderBody({ hasSearchQuery: false, onRecentSearch });
    fireEvent.press(screen.getByLabelText('Recent search: iphone'));
    expect(onRecentSearch).toHaveBeenCalledWith('iphone');
    expect(screen.getByLabelText('Category: Phones')).toBeTruthy();
  });
  it('blocks results behind invalid filters, offline, and loading states', () => {
    const invalid = renderBody({ invalidFilters: true });
    expect(invalid.getByRole('alert')).toBeTruthy();
    invalid.unmount();
    const offline = renderBody({ isOnline: false });
    expect(
      offline.getByText('Connect to the internet to search products')
    ).toBeTruthy();
    offline.unmount();
    const loading = renderBody({ isLoading: true, products: [] });
    expect(loading.getByTestId('mock-loading-cards')).toBeTruthy();
  });
  it('keeps the retry path for a failed search instead of empty results', () => {
    const onRetry = jest.fn();
    renderBody({ searchError: 'boom', products: [], onRetry });
    fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it('renders the results list once products load', () => {
    renderBody();
    expect(screen.getByTestId('mock-results-list')).toBeTruthy();
  });
  it('offers a continuation when the first page is empty but more exist', () => {
    const onRetryNextPage = jest.fn();
    renderBody({ products: [], hasMore: true, onRetryNextPage });
    expect(screen.getByText('More results available')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Load more results' }));
    expect(onRetryNextPage).toHaveBeenCalledTimes(1);
  });
  it('scrolls idle suggestions with dock clearance', () => {
    const view = renderBody({
      hasSearchQuery: false,
      bottomSpace: 100,
      insetsBottom: 34,
      isKeyboardVisible: false,
      keyboardHeight: 0,
    });
    const scroller = view.UNSAFE_getByType(ScrollView);
    expect(scroller.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroller.props.contentContainerStyle).toEqual({
      paddingBottom: 134,
    });
    view.unmount();
    const keyboard = renderBody({
      hasSearchQuery: false,
      isKeyboardVisible: true,
      keyboardHeight: 300,
    });
    expect(
      keyboard.UNSAFE_getByType(ScrollView).props.contentContainerStyle
    ).toEqual({ paddingBottom: 400 });
  });
});
