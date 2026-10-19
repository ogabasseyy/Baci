import { render, screen } from '@testing-library/react-native';

const mockRedvaultProps = jest.fn();
const mockLocationProps = jest.fn();
const mockPaymentProps = jest.fn();

jest.mock('./redvault/RedvaultOrderReview', () => ({
  RedvaultOrderReview: (props: Record<string, unknown>) => {
    mockRedvaultProps(props);
    const { Text } = require('react-native');
    const { createElement } = require('react');
    return createElement(Text, { testID: 'redvault-review' }, 'redvault');
  },
}));

jest.mock('./CheckoutLocationPickerOverlays', () => ({
  CheckoutLocationPickerOverlays: (props: Record<string, unknown>) => {
    mockLocationProps(props);
    const { Text } = require('react-native');
    const { createElement } = require('react');
    return createElement(Text, { testID: 'location-overlays' }, 'location');
  },
}));

jest.mock('./CheckoutPaymentOverlays', () => ({
  CheckoutPaymentOverlays: (props: Record<string, unknown>) => {
    mockPaymentProps(props);
    const { Text } = require('react-native');
    const { createElement } = require('react');
    return createElement(Text, { testID: 'payment-overlays' }, 'payment');
  },
}));

import { CheckoutOverlays } from './CheckoutOverlays';

describe('CheckoutOverlays', () => {
  it('renders all three overlay groups with their props forwarded', () => {
    const closeRedvaultReview = jest.fn();
    const clearCart = jest.fn();
    const colors = { primary: '#000' };
    const shipping = { state: 'Lagos' };
    const crypto = { enabled: true };
    const redvaultReview = { orderId: 'order-1' };

    render(
      <CheckoutOverlays
        redvaultReview={redvaultReview as never}
        closeRedvaultReview={closeRedvaultReview}
        colors={colors as never}
        isDark={false}
        shipping={shipping as never}
        watchedCity="Ikeja"
        watchedState="Lagos"
        crypto={crypto as never}
        clearCart={clearCart}
        isProcessing={false}
        removeClippedSubviews={true}
      />
    );

    expect(screen.getByTestId('redvault-review')).toBeTruthy();
    expect(screen.getByTestId('location-overlays')).toBeTruthy();
    expect(screen.getByTestId('payment-overlays')).toBeTruthy();
    expect(mockRedvaultProps).toHaveBeenCalledWith({
      input: redvaultReview,
      onClose: closeRedvaultReview,
    });
    expect(mockLocationProps).toHaveBeenCalledWith(
      expect.objectContaining({
        colors,
        isDark: false,
        removeClippedSubviews: true,
        shipping,
        watchedCity: 'Ikeja',
        watchedState: 'Lagos',
      })
    );
    expect(mockPaymentProps).toHaveBeenCalledWith(
      expect.objectContaining({
        crypto,
        clearCart,
        colors,
        isProcessing: false,
      })
    );
  });
});
