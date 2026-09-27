import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import type { Product } from '@/types/product';
import { HomeFeedListItemView } from './HomeFeedListItemView';

jest.mock('@/components/storefront/ProductCard', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Text: MockText, View: MockView } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    ProductCard: ({
      product,
      variant,
    }: {
      product: { id: string };
      variant: string;
    }) =>
      React.createElement(
        MockView,
        { testID: `product-card-${product.id}` },
        React.createElement(MockText, null, `variant:${variant}`)
      ),
  };
});

const product = { id: 'p1' } as Product;

describe('HomeFeedListItemView', () => {
  it('renders even-index grid products on the left', () => {
    // Arrange & Act
    render(
      <HomeFeedListItemView
        item={{ kind: 'product', product }}
        index={0}
        currentVariant="grid"
        onProductDataEndReached={() => {}}
      />
    );

    // Assert
    expect(screen.getByTestId('product-card-p1')).toBeTruthy();
    expect(screen.getByText('variant:grid')).toBeTruthy();
  });

  it('renders list-variant products without the grid variant', () => {
    // Arrange & Act
    render(
      <HomeFeedListItemView
        item={{ kind: 'product', product }}
        index={3}
        currentVariant="list"
        onProductDataEndReached={() => {}}
      />
    );

    // Assert
    expect(screen.getByText('variant:list')).toBeTruthy();
  });

  it('fires pagination when the sentinel lays out in a cell', () => {
    // Arrange
    const onProductDataEndReached = jest.fn();

    // Act
    render(
      <HomeFeedListItemView
        item={{ kind: 'product-list-end', id: 'end' }}
        index={4}
        target="Cell"
        currentVariant="grid"
        onProductDataEndReached={onProductDataEndReached}
      />
    );
    fireEvent(screen.getByTestId('home-feed-product-end-sentinel'), 'layout');

    // Assert
    expect(onProductDataEndReached).toHaveBeenCalledTimes(1);
  });

  it('does not fire pagination outside a cell layout', () => {
    // Arrange
    const onProductDataEndReached = jest.fn();

    // Act
    const { UNSAFE_getByType } = render(
      <HomeFeedListItemView
        item={{ kind: 'product-list-end', id: 'end' }}
        index={4}
        currentVariant="grid"
        onProductDataEndReached={onProductDataEndReached}
      />
    );

    // Assert
    expect(UNSAFE_getByType(View).props.onLayout).toBeUndefined();
    expect(onProductDataEndReached).not.toHaveBeenCalled();
  });
});
