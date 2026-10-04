import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

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

it('places the bottom composer flush above the keyboard without subtracting the top inset', () => {
  mockKeyboard.isKeyboardVisible = true;
  mockKeyboard.keyboardTop = 500;
  mockKeyboard.keyboardHeight = 300;
  renderView();
  const dock = screen.getByTestId('keyboard-dock');
  expect(dock.props.offset.opened - mockKeyboard.keyboardHeight + 72).toBe(500);
  expect(screen.getByPlaceholderText('Search or ask a question…')).toBeTruthy();
});

it('keeps one back action at the top, separate from the keyboard search surface', () => {
  renderView();
  const back = screen.getByRole('button', { name: 'Go back' });
  const dock = screen.getByTestId('keyboard-dock-space');
  expect(screen.getAllByRole('button', { name: 'Go back' })).toHaveLength(1);
  let parent = back.parent;
  while (parent) {
    expect(parent).not.toBe(dock);
    parent = parent.parent;
  }
});

it('puts tappable suggestions inside the keyboard dock and applies one without an extra step', () => {
  mockKeyboard.isKeyboardVisible = true;
  mockKeyboard.keyboardTop = 500;
  mockKeyboard.keyboardHeight = 300;
  const apply = jest.fn();
  renderView({
    query: 'iphone',
    committedQuery: 'iphone',
    onApplyAssistance: apply,
    products: [{ id: 'p1', price: 250000, condition: 'used' } as Product],
  });
  const suggestion = screen.getByRole('button', {
    name: 'Search suggestion: Used iphone',
  });
  const dock = screen.getByTestId('keyboard-dock-space');
  let parent = suggestion.parent;
  let inside = false;
  while (parent) {
    if (parent === dock) inside = true;
    parent = parent.parent;
  }
  expect(inside).toBe(true);
  expect(screen.queryByText('✦ Find for me')).toBeNull();
  fireEvent.press(suggestion);
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'iphone', filters: { condition: 'used' } })
  );
});
it('hides the suggestion row when the keyboard closes', () => {
  renderView({
    query: 'iphone',
    committedQuery: 'iphone',
    onApplyAssistance: jest.fn(),
    products: [{ id: 'p1', price: 250000, condition: 'used' } as Product],
  });
  expect(screen.queryByTestId('search-suggestion-row')).toBeNull();
});

it('routes result scrolling to the toolbar and keeps filter sheets visible', () => {
  renderView({
    hasSearchQuery: true,
    query: 'iphone',
    committedQuery: 'iphone',
    refinements: { brands: [], sort: 'relevance' },
    onRefinementsChange: jest.fn(),
    products: [{ id: 'p1', name: 'iPhone', price: 100 } as Product],
  });
  const scroll = (y: number) =>
    act(() =>
      mockResultsEvents.onScroll?.({
        nativeEvent: {
          contentOffset: { y },
          contentSize: { height: 1000 },
          layoutMeasurement: { height: 500 },
        },
      } as NativeSyntheticEvent<NativeScrollEvent>)
    );
  scroll(120);
  expect(
    screen.getByTestId('search-toolbar-reveal', { includeHiddenElements: true })
      .props.pointerEvents
  ).toBe('none');
  scroll(80);
  expect(
    screen.getByTestId('search-toolbar-reveal', { includeHiddenElements: true })
      .props.pointerEvents
  ).toBe('auto');
  fireEvent.press(screen.getByLabelText('Filters'));
  scroll(160);
  expect(
    screen.getByTestId('search-toolbar-reveal', { includeHiddenElements: true })
      .props.pointerEvents
  ).toBe('auto');
  expect(screen.getByLabelText('Apply filters')).toBeTruthy();
});

it('keeps the final cards above an enlarged keyboard search surface', () => {
  mockKeyboard.isKeyboardVisible = true;
  mockKeyboard.keyboardHeight = 320;
  renderView({
    hasSearchQuery: true,
    query: 'iphone',
    committedQuery: 'iphone',
    products: [{ id: 'p1', name: 'Phone', price: 100 } as Product],
  });
  fireEvent(screen.getByTestId('keyboard-dock-surface'), 'layout', {
    nativeEvent: { layout: { height: 240 } },
  });
  expect(mockResultsEvents.bottomSpace).toBe(594);
});
