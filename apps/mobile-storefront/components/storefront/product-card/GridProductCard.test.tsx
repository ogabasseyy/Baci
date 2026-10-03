import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Colors, { BRAND, withAlpha } from '@/constants/Colors';
import type { Product } from '@/types/product';
import { formatPrice } from '@/types/product';
import GridProductCard from './GridProductCard';

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual('react-native').View,
    createAnimatedComponent: (component: unknown) => component,
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');

  return {
    Ionicons: ({ name, ...props }: { name: string }) =>
      React.createElement(Text, { testID: `icon-${name}`, ...props }, name),

    default: ({ name, ...props }: { name: string }) =>
      React.createElement(
        Text,
        {
          testID: `icon-${name}`,
          ...props,
        },
        name
      ),
    __esModule: true,
  };
});

const baseProduct: Product = {
  id: 'product-1',
  name: 'iPhone 13 Pro',
  slug: 'iphone-13-pro',
  price: 552000,
  image: 'https://cdn.example.com/iphone-13-pro.jpg',
  images: ['https://cdn.example.com/iphone-13-pro.jpg'],
  condition: 'New',
  rating: 4.2,
  review_count: 12,
};

function renderCard(
  overrides: Partial<ComponentProps<typeof GridProductCard>> = {}
) {
  const props: ComponentProps<typeof GridProductCard> = {
    product: baseProduct,
    imageSource: { uri: baseProduct.image },
    imageProps: { contentFit: 'cover' },
    showLocalPlaceholder: false,
    handlePress: jest.fn(),
    handleAnimateIn: jest.fn(),
    handleAnimateOut: jest.fn(),
    handleWishlistPress: jest.fn(),
    handleAddToCart: jest.fn(),
    isSaved: false,
    cartItemCount: 0,
    animatedStyle: {},
    heartAnimatedStyle: {},
    gridWidth: 180,
    shadowColor: '#000',
    ...overrides,
  };

  return {
    ...render(<GridProductCard {...props} />),
    props,
  };
}

describe('GridProductCard', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
  });

  it('renders placeholder content when no local image is available', () => {
    renderCard({ showLocalPlaceholder: true });

    expect(screen.getByTestId('grid-product-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('grid-product-image')).toBeNull();
  });

  it('renders product details, image, and rating state', () => {
    renderCard();

    expect(screen.getByText(baseProduct.name)).toBeTruthy();
    expect(screen.getByText(formatPrice(baseProduct.price))).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByLabelText(`${baseProduct.name} image`)).toBeTruthy();
    expect(screen.queryAllByTestId('icon-star')).toHaveLength(4);
    expect(screen.queryAllByTestId('icon-star-outline')).toHaveLength(1);
  });

  it('formats condition badges in sentence case on the grid card', () => {
    renderCard({
      product: {
        ...baseProduct,
        condition: 'Open Box',
      },
    });

    expect(screen.getByText('Open Box')).toBeTruthy();
  });

  it('renders a no-ratings state when product rating is missing', () => {
    renderCard({
      product: {
        ...baseProduct,
        condition: undefined,
        rating: undefined,
      },
    });

    expect(screen.getByLabelText('No ratings')).toBeTruthy();
    expect(screen.queryByText('New')).toBeNull();
  });

  it('announces wishlist checked state for saved and unsaved modes', () => {
    const unsaved = renderCard({ isSaved: false });

    expect(
      screen.getByLabelText(`Save ${baseProduct.name} for later`).props
        .accessibilityState
    ).toEqual({ checked: false });

    unsaved.unmount();
    renderCard({ isSaved: true });

    expect(
      screen.getByLabelText(`Remove ${baseProduct.name} from saved items`).props
        .accessibilityState
    ).toEqual({ checked: true });
  });

  it('wires press handlers for the card, wishlist, and add-to-cart actions', () => {
    const handlePress = jest.fn();
    const handleWishlistPress = jest.fn();
    const handleAddToCart = jest.fn();

    renderCard({
      handlePress,
      handleWishlistPress,
      handleAddToCart,
      cartItemCount: 2,
      isSaved: true,
    });

    fireEvent.press(
      screen.getByLabelText(
        `${baseProduct.name}, ${formatPrice(baseProduct.price)}`
      )
    );
    fireEvent.press(
      screen.getByLabelText(`Remove ${baseProduct.name} from saved items`)
    );
    fireEvent.press(screen.getByLabelText(`Add ${baseProduct.name} to cart`));

    expect(handlePress).toHaveBeenCalledTimes(1);
    expect(handleWishlistPress).toHaveBeenCalledTimes(1);
    expect(handleAddToCart).toHaveBeenCalledTimes(1);

    expect(StyleSheet.flatten(screen.getByText('2').props.style)).toMatchObject(
      { color: BRAND.onPrimary }
    );
    expect(
      StyleSheet.flatten(
        screen.getByTestId('grid-wishlist-surface').props.style
      )
    ).toMatchObject({
      backgroundColor: withAlpha(Colors.light.card, 0.8),
    });
    expect(
      StyleSheet.flatten(
        screen.getByLabelText(`Add ${baseProduct.name} to cart`).props.style
      )
    ).toMatchObject({ shadowColor: Colors.light.black });
  });

  it('uses CSS box shadows instead of native shadow props on web', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });

    renderCard();

    const cardStyle = StyleSheet.flatten(
      screen.getByLabelText(
        `${baseProduct.name}, ${formatPrice(baseProduct.price)}`
      ).props.style
    );
    const cartStyle = StyleSheet.flatten(
      screen.getByLabelText(`Add ${baseProduct.name} to cart`).props.style
    );

    expect(cardStyle.boxShadow).toBe('0px 2px 4px rgba(0, 0, 0, 0.05)');
    expect(cardStyle.shadowColor).toBeUndefined();
    expect(cartStyle.boxShadow).toBe('0px 2px 4px rgba(0, 0, 0, 0.1)');
    expect(cartStyle.shadowColor).toBeUndefined();
  });
});
it('renders name and price before any image load completes', () => {
  renderCard();
  expect(screen.getByText(baseProduct.name)).toBeTruthy();
  expect(screen.getByText(formatPrice(baseProduct.price))).toBeTruthy();
});
