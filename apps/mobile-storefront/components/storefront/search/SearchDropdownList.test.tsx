import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { Category } from '@/hooks';
import type { Product } from '@/types/product';
import { SearchDropdownList } from './SearchDropdownList';

jest.mock('@/components/ui/SafeImage', () => ({
  SafeImage: () => null,
}));

const categories: Category[] = [
  { id: 'cat-1', name: 'Phones', slug: 'phones' },
];

const products: Product[] = [
  {
    id: 'product-1',
    image: 'https://example.com/iphone.png',
    name: 'iPhone 14 Pro',
    price: 1200000,
    slug: 'iphone-14-pro',
  },
];

describe('SearchDropdownList', () => {
  it('renders idle recent/category state and triggers handlers', () => {
    const onSuggestionPress = jest.fn();
    const onCategoryPress = jest.fn();
    const onClearHistory = jest.fn();

    render(
      <SearchDropdownList
        categories={categories}
        colors={Colors.light}
        isLoading={false}
        onCategoryPress={onCategoryPress}
        onClearHistory={onClearHistory}
        onProductPress={() => {}}
        onSuggestionPress={onSuggestionPress}
        products={[]}
        query=""
        recentSearches={['iphone']}
      />
    );

    fireEvent.press(screen.getByLabelText('Search for iphone'));
    fireEvent.press(screen.getByLabelText('Browse Phones'));
    fireEvent.press(screen.getByText('Clear'));

    expect(onSuggestionPress).toHaveBeenCalledWith('iphone');
    expect(onCategoryPress).toHaveBeenCalledWith('phones');
    expect(onClearHistory).toHaveBeenCalled();
  });

  it('shows loading text while searching', () => {
    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        isLoading
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSuggestionPress={() => {}}
        products={[]}
        query="ip"
        recentSearches={[]}
      />
    );

    expect(screen.getByText('Searching…')).toBeTruthy();
  });

  it('renders results and selects a product', () => {
    const onProductPress = jest.fn();

    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={onProductPress}
        onSuggestionPress={() => {}}
        products={products}
        query="iphone"
        recentSearches={[]}
      />
    );

    fireEvent.press(screen.getByLabelText(/iPhone 14 Pro/i));
    expect(onProductPress).toHaveBeenCalledWith(products[0]);
  });

  it('submits the current input rather than the debounced suggestion query', () => {
    const onSeeAllResults = jest.fn();

    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        currentQuery="iphone 15 pro"
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSeeAllResults={onSeeAllResults}
        onSuggestionPress={() => {}}
        products={products}
        query="iph"
        recentSearches={[]}
      />
    );

    fireEvent.press(screen.getByLabelText('See all results for iphone 15 pro'));
    expect(onSeeAllResults).toHaveBeenCalledWith('iphone 15 pro');
  });

  it('shows the minimum-length hint after a short submit attempt', () => {
    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        currentQuery="i"
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSeeAllResults={() => {}}
        onSuggestionPress={() => {}}
        products={[]}
        query=""
        recentSearches={[]}
        showMinLengthHint
      />
    );

    expect(
      screen.getByLabelText('Type at least 2 characters to search')
    ).toBeTruthy();
    expect(screen.queryByLabelText(/see all results/i)).toBeNull();
  });

  it.each([
    ['settled debounced query', '!!'],
    ['unsettled debounce', ''],
  ])('shows the hint and hides see-all for punctuation-only input (%s)', (_label, query) => {
    // "!!" passes the length check but normalizes to nothing, so the
    // submit gate rejects it: the hint must explain why instead of
    // leaving a visible button that does nothing when pressed — both
    // before the debounce settles and after.
    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        currentQuery="!!"
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSeeAllResults={() => {}}
        onSuggestionPress={() => {}}
        products={[]}
        query={query}
        recentSearches={[]}
        showMinLengthHint
      />
    );

    expect(
      screen.getByLabelText('Type at least 2 characters to search')
    ).toBeTruthy();
    expect(screen.queryByLabelText(/see all results/i)).toBeNull();
    expect(screen.queryByText(/no results for/i)).toBeNull();
  });

  it('hides stale settled results when the current input is rejected before the debounce settles', () => {
    // Valid `iphone` results have settled, then the shopper replaces the
    // input with `!!` and submits before the 300 ms debounce completes:
    // the hint must explain the rejection immediately instead of leaving
    // the stale, tappable iPhone results on screen.
    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        currentQuery="!!"
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSeeAllResults={() => {}}
        onSuggestionPress={() => {}}
        products={products}
        query="iphone"
        recentSearches={[]}
        showMinLengthHint
      />
    );

    expect(
      screen.getByLabelText('Type at least 2 characters to search')
    ).toBeTruthy();
    expect(screen.queryByLabelText(/iPhone 14 Pro/i)).toBeNull();
    expect(screen.queryByLabelText(/see all results/i)).toBeNull();
  });

  it('hides the minimum-length hint once the input is long enough', () => {
    render(
      <SearchDropdownList
        categories={[]}
        colors={Colors.light}
        currentQuery="iphone"
        isLoading={false}
        onCategoryPress={() => {}}
        onClearHistory={() => {}}
        onProductPress={() => {}}
        onSeeAllResults={() => {}}
        onSuggestionPress={() => {}}
        products={[]}
        query=""
        recentSearches={[]}
        showMinLengthHint
      />
    );

    expect(
      screen.queryByLabelText('Type at least 2 characters to search')
    ).toBeNull();
    expect(screen.getByLabelText('See all results for iphone')).toBeTruthy();
  });
});
