import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import CartLoadedView from './CartLoadedView';

jest.mock('@/components/ui/SafeImage', () => ({
  SafeImage: function MockSafeImage() {
    return null;
  },
}));

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GadgetPattern: () => <Text>GadgetPattern</Text>,
  };
});

jest.mock('@/components/checkout/checkout-identity', () => ({
  CheckoutIdentityModal: function MockCheckoutIdentityModal() {
    return null;
  },
}));

jest.mock('@/components/ads/AdSlot', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: { View },
    View,
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (updater: () => object) => updater(),
    useSharedValue: (initialValue: number) => {
      let value = initialValue;
      return {
        get value() {
          return value;
        },
        set value(nextValue: number) {
          value = nextValue;
        },
        get: () => value,
        set: (nextValue: number) => {
          value = nextValue;
        },
      };
    },
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

const item: CartItem = {
  id: 'cart-1',
  product_id: 'product-1',
  slug: 'iphone-13-pro',
  name: 'iPhone 13 Pro',
  price: 500000,
  quantity: 1,
  condition: 'NEW',
};

const formatPrice = (amount: number) =>
  `₦${new Intl.NumberFormat('en-NG').format(amount)}`;

function renderView(
  overrides: Partial<ComponentProps<typeof CartLoadedView>> = {}
) {
  const props: ComponentProps<typeof CartLoadedView> = {
    colors: Colors.light,
    colorScheme: 'light',
    enableNegotiationModal: true,
    formatPrice,
    grandTotal: item.price,
    handleCheckout: jest.fn(),
    handleClearCart: jest.fn(),
    handleReturnHome: jest.fn(),
    handleQuantityChange: jest.fn(),
    handleRemoveItem: jest.fn(),
    hasNonNegotiableCartItem: false,
    insetsTop: 16,
    isIdentityModalOpen: false,
    itemCount: 1,
    items: [item],
    onBulkNegotiate: jest.fn(),
    onCheckoutPressIn: jest.fn(),
    onCloseIdentityModal: jest.fn(),
    onCloseNegotiateWarning: jest.fn(),
    onNegotiateItem: jest.fn(),
    onNegotiateTotal: jest.fn(),
    onOpenItemNegotiation: jest.fn(),
    pendingNegotiateItem: null,
    removeClippedSubviews: false,
    showNegotiateWarning: false,
    toggleAssurance: jest.fn(),
    triggerHaptic: jest.fn(),
    updateQuantity: jest.fn(),
    ...overrides,
  };

  return { props, ...render(<CartLoadedView {...props} />) };
}

describe('CartLoadedView', () => {
  it('exposes clear-cart and checkout actions with their current values', () => {
    const handleClearCart = jest.fn();
    const handleCheckout = jest.fn();

    renderView({ handleClearCart, handleCheckout });

    fireEvent.press(screen.getByRole('button', { name: 'Clear cart' }));
    fireEvent.press(
      screen.getByRole('button', {
        name: `Proceed to checkout, total ${formatPrice(item.price)}`,
      })
    );

    expect(handleClearCart).toHaveBeenCalledTimes(1);
    expect(handleCheckout).toHaveBeenCalledTimes(1);
  });

  it('delegates the cart header back action', () => {
    const handleReturnHome = jest.fn();

    renderView({ handleReturnHome });

    fireEvent.press(screen.getByRole('button', { name: 'Back to home' }));

    expect(handleReturnHome).toHaveBeenCalledTimes(1);
  });

  it('delegates total negotiation from the footer action', () => {
    const onNegotiateTotal = jest.fn();

    renderView({ onNegotiateTotal });

    fireEvent.press(
      screen.getByRole('button', { name: 'Negotiate cart total' })
    );

    expect(onNegotiateTotal).toHaveBeenCalledTimes(1);
  });

  it('hides the cart-wide negotiate control when a non-negotiable item is present', () => {
    renderView({ hasNonNegotiableCartItem: true });

    expect(
      screen.queryByRole('button', { name: 'Negotiate cart total' })
    ).toBeNull();
  });

  it('delegates modal bulk negotiation separately from the footer action', () => {
    const onBulkNegotiate = jest.fn();
    const onNegotiateTotal = jest.fn();

    renderView({
      onBulkNegotiate,
      onNegotiateTotal,
      showNegotiateWarning: true,
    });

    fireEvent.press(screen.getByText('Bulk Negotiate Entire Cart'));

    expect(onBulkNegotiate).toHaveBeenCalledTimes(1);
    expect(onNegotiateTotal).not.toHaveBeenCalled();
  });

  it('renders the footer ad only when no modal covers the cart', () => {
    // Regression: an obscured CART_MPU must not load behind the identity
    // or negotiation-warning modals.
    const { rerender, props } = renderView();

    expect(screen.getByTestId('ad-slot-CART_MPU')).toBeTruthy();

    rerender(<CartLoadedView {...props} isIdentityModalOpen />);
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();

    rerender(
      <CartLoadedView
        {...props}
        isIdentityModalOpen={false}
        showNegotiateWarning
      />
    );
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();
  });
});
