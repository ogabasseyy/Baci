import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { CompareView } from './CompareView';

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight?.() ?? null,
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
      source,
      testID,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
      source?: unknown;
      testID?: string;
    }) => {
      const viewProps = {
        testID: testID ?? 'compare-product-image',
        accessibilityLabel: accessibilityLabel ?? 'compare product image',
        accessibilityRole: 'image' as const,
        autoplay,
        source,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'blurhash' },
}));

const phone: Product = {
  id: 'phone-1',
  slug: 'phone-one',
  name: 'Phone One',
  price: 120000,
  compare_at_price: 150000,
  image: 'https://example.com/phone.png',
  brand: 'Baci',
  condition: 'new',
  rating: 4.5,
  specifications: { Storage: '256 GB' },
};

const minimalPhone: Product = {
  id: 'phone-2',
  slug: 'phone-two',
  name: 'Phone Two',
  price: 90000,
  image: '',
};

function createProps() {
  return {
    allSpecKeys: ['Storage'],
    bottomInset: 20,
    colors: Colors.light,
    onAddToCart: jest.fn(),
    onBrowseProducts: jest.fn(),
    onClearComparison: jest.fn(),
    onOpenProduct: jest.fn(),
    onRemoveProduct: jest.fn(),
    products: [phone],
  };
}

describe('CompareView', () => {
  it('renders the empty state with an accessible browse action', () => {
    const onBrowseProducts = jest.fn();

    render(
      <CompareView
        {...createProps()}
        onBrowseProducts={onBrowseProducts}
        products={[]}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Browse Products' }));

    expect(screen.getByText('No products to compare')).toBeTruthy();
    expect(onBrowseProducts).toHaveBeenCalledTimes(1);
  });

  it('renders compared product data and delegates labeled product actions', () => {
    const onAddToCart = jest.fn();
    const onClearComparison = jest.fn();
    const onOpenProduct = jest.fn();
    const onRemoveProduct = jest.fn();

    render(
      <CompareView
        {...createProps()}
        onAddToCart={onAddToCart}
        onClearComparison={onClearComparison}
        onOpenProduct={onOpenProduct}
        onRemoveProduct={onRemoveProduct}
      />
    );

    expect(screen.getByText('Phone One')).toBeTruthy();
    expect(screen.getByText('256 GB')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Clear comparison' }));
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Remove Phone One from comparison',
      })
    );
    fireEvent.press(screen.getByRole('button', { name: 'View Phone One' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Add Phone One to cart' })
    );

    expect(onClearComparison).toHaveBeenCalledTimes(1);
    expect(onRemoveProduct).toHaveBeenCalledWith('phone-1');
    expect(onOpenProduct).toHaveBeenCalledWith(phone);
    expect(onAddToCart).toHaveBeenCalledWith(phone);
  });

  it('renders multiple products with missing-value fallbacks', () => {
    render(
      <CompareView
        {...createProps()}
        allSpecKeys={['Storage']}
        products={[phone, minimalPhone]}
      />
    );

    expect(screen.getByText('Phone One')).toBeTruthy();
    expect(screen.getByText('Phone Two')).toBeTruthy();
    expect(screen.getByText('Baci')).toBeTruthy();
    expect(screen.getByText('N/A')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add Phone Two to cart' })
    ).toBeTruthy();
  });

  describe('bugfix: animated catalog images on compare surfaces', () => {
    it('does not autoplay product images in the compare grid', () => {
      render(
        <CompareView
          {...createProps()}
          products={[
            {
              ...phone,
              image: 'https://example.com/phone.gif',
            },
          ]}
        />
      );

      // Nested under a Pressable button, so role queries hide the image.
      expect(screen.getByTestId('compare-product-image').props.autoplay).toBe(
        false
      );
    });

    it('bounds managed catalog images to the compare cell and static fallback', () => {
      render(
        <CompareView
          {...createProps()}
          products={[
            {
              ...phone,
              image:
                'https://cdn.ogabassey.com/core-assets/products/phone.avif',
            },
          ]}
        />
      );

      expect(screen.getByTestId('compare-product-image').props.source).toEqual({
        height: 216,
        uri: 'https://cdn.ogabassey.com/image/width=216,height=216,quality=82,format=webp,fit=cover/core-assets/products/phone.avif',
        width: 216,
      });
    });
  });
});
