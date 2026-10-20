import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { withRepeat } from 'react-native-reanimated';
import Colors from '@/constants/Colors';
import CartCheckoutFooter from './CartCheckoutFooter';

jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: { View },
    View,
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (updater: () => object) => updater(),
    useSharedValue: (value: number) => {
      let current = value;
      return {
        get: () => current,
        set: (next: number) => {
          current = next;
        },
      };
    },
    withRepeat: jest.fn((value: number) => value),
    withSequence: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

const formatPrice = (amount: number) => `NGN ${amount.toLocaleString()}`;

describe('CartCheckoutFooter', () => {
  it('uses a finite checkout attention cue instead of an idle animation loop', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState'
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    try {
      render(
        <CartCheckoutFooter
          checkoutDotColor="#fff"
          colors={Colors.light}
          enableNegotiationModal={false}
          formatPrice={formatPrice}
          grandTotal={250000}
          hasAcceptedNegotiation={false}
          onCheckout={jest.fn()}
          onCheckoutPressIn={jest.fn()}
          onNegotiateTotal={jest.fn()}
          surfaceInset={Colors.light.background}
        />
      );
      expect(withRepeat).toHaveBeenLastCalledWith(expect.anything(), 3, false);
    } finally {
      if (descriptor)
        Object.defineProperty(AppState, 'currentState', descriptor);
    }
  });

  it('exposes checkout and total negotiation actions', () => {
    const onCheckout = jest.fn();
    const onNegotiateTotal = jest.fn();

    render(
      <CartCheckoutFooter
        checkoutDotColor="#fff"
        colors={Colors.light}
        enableNegotiationModal
        formatPrice={formatPrice}
        grandTotal={500000}
        hasAcceptedNegotiation={false}
        onCheckout={onCheckout}
        onCheckoutPressIn={jest.fn()}
        onNegotiateTotal={onNegotiateTotal}
        surfaceInset={Colors.light.background}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Negotiate cart total' })
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: `Proceed to checkout, total ${formatPrice(500000)}`,
      })
    );

    expect(onNegotiateTotal).toHaveBeenCalledTimes(1);
    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it('hides cart negotiation when the template does not enable it', () => {
    render(
      <CartCheckoutFooter
        checkoutDotColor="#fff"
        colors={Colors.light}
        enableNegotiationModal={false}
        formatPrice={formatPrice}
        grandTotal={500000}
        hasAcceptedNegotiation={false}
        onCheckout={jest.fn()}
        onCheckoutPressIn={jest.fn()}
        onNegotiateTotal={jest.fn()}
        surfaceInset={Colors.light.background}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Negotiate cart total' })
    ).toBeNull();
  });

  it('keeps accepted-negotiation presses delegated to route policy', () => {
    const onNegotiateTotal = jest.fn();

    render(
      <CartCheckoutFooter
        checkoutDotColor="#fff"
        colors={Colors.light}
        enableNegotiationModal
        formatPrice={formatPrice}
        grandTotal={500000}
        hasAcceptedNegotiation
        onCheckout={jest.fn()}
        onCheckoutPressIn={jest.fn()}
        onNegotiateTotal={onNegotiateTotal}
        surfaceInset={Colors.light.background}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Negotiate cart total' })
    );
    expect(onNegotiateTotal).toHaveBeenCalledTimes(1);
  });

  it('hides the cart-total negotiation action when a best-price item is present', () => {
    render(
      <CartCheckoutFooter
        checkoutDotColor="#fff"
        colors={Colors.light}
        enableNegotiationModal
        formatPrice={formatPrice}
        grandTotal={500000}
        hasAcceptedNegotiation={false}
        hasNonNegotiableItem
        onCheckout={jest.fn()}
        onCheckoutPressIn={jest.fn()}
        onNegotiateTotal={jest.fn()}
        surfaceInset={Colors.light.background}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Negotiate cart total' })
    ).toBeNull();
  });

  it('warms checkout when the checkout action receives press-in', () => {
    const onCheckoutPressIn = jest.fn();

    render(
      <CartCheckoutFooter
        checkoutDotColor="#fff"
        colors={Colors.light}
        enableNegotiationModal
        formatPrice={formatPrice}
        grandTotal={500000}
        hasAcceptedNegotiation={false}
        onCheckout={jest.fn()}
        onCheckoutPressIn={onCheckoutPressIn}
        onNegotiateTotal={jest.fn()}
        surfaceInset={Colors.light.background}
      />
    );

    fireEvent(
      screen.getByRole('button', {
        name: `Proceed to checkout, total ${formatPrice(500000)}`,
      }),
      'pressIn'
    );

    expect(onCheckoutPressIn).toHaveBeenCalledTimes(1);
  });
});
