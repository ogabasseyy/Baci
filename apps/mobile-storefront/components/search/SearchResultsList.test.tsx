import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import SearchResultsList from './SearchResultsList';

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

jest.mock('@/components/storefront/ProductCard', () => ({
  ProductCard: () => null,
}));

function renderList(
  overrides: Partial<ComponentProps<typeof SearchResultsList>> = {}
) {
  const props: ComponentProps<typeof SearchResultsList> = {
    colors: Colors.light,
    committedQuery: '',
    isLoadingMore: false,
    isNextPageError: false,
    isRetrying: false,
    listError: null,
    onEndReached: jest.fn(),
    onProductPress: jest.fn(),
    onRetry: jest.fn(),
    onRetryNextPage: jest.fn(),
    products: [],
    totalCount: 0,
    ...overrides,
  };

  return render(<SearchResultsList {...props} />);
}

describe('SearchResultsList', () => {
  it('shows a truthful loaded count and appends pages at the list end', () => {
    const onEndReached = jest.fn();
    const products = [
      { id: 'product-1', name: 'iPhone 16' },
      { id: 'product-2', name: 'iPhone 15' },
    ] as Product[];

    renderList({
      committedQuery: 'iphone',
      onEndReached,
      products,
      totalCount: 45,
    });

    expect(
      screen.getByText('Showing 2 of 45 results for “iphone”')
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('mock-flash-end-reached'));
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('shows the total once every match is loaded', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderList({
      committedQuery: 'iphone 16',
      products,
      totalCount: 1,
    });

    expect(screen.getByText('1 result for “iphone 16”')).toBeTruthy();
  });

  it('shows a loading footer while more results append', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderList({
      committedQuery: 'iphone',
      isLoadingMore: true,
      products,
      totalCount: 45,
    });

    expect(screen.getByText('Loading more…')).toBeTruthy();
  });

  it('keeps loaded products visible when the next page fails', () => {
    const onRetry = jest.fn();
    const onRetryNextPage = jest.fn();
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderList({
      committedQuery: 'iphone',
      isNextPageError: true,
      listError: 'Search failed',
      onRetry,
      onRetryNextPage,
      products,
      totalCount: 45,
    });

    expect(screen.getByTestId('mock-flash-item-product-1')).toBeTruthy();
    expect(screen.getByText("Couldn't load more results.")).toBeTruthy();

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry loading more results' })
    );
    expect(onRetryNextPage).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('shows progress instead of the retry while a refetch retry pends', () => {
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderList({
      committedQuery: 'iphone',
      isNextPageError: false,
      isRetrying: true,
      listError: 'Search failed',
      products,
      totalCount: 45,
    });

    expect(screen.getByText('Retrying…')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Retry loading more results' })
    ).toBeNull();
  });

  it('refetches loaded pages when a background refetch fails', () => {
    const onRetry = jest.fn();
    const onRetryNextPage = jest.fn();
    const products = [{ id: 'product-1', name: 'iPhone 16' }] as Product[];

    renderList({
      committedQuery: 'iphone',
      isNextPageError: false,
      listError: 'Search failed',
      onRetry,
      onRetryNextPage,
      products,
      totalCount: 45,
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry loading more results' })
    );
    // A failed reconnect refetch retains products with the same generic
    // error: retrying must replay the loaded pages, not append an offset.
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetryNextPage).not.toHaveBeenCalled();
  });
});
