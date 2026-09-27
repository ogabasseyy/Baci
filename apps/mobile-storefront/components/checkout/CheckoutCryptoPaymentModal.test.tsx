import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutCryptoPaymentModal } from './CheckoutCryptoPaymentModal';

const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(async () => true),
}));

describe('CheckoutCryptoPaymentModal', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear();
  });

  it("forwards the provider reference when I've sent the payment", async () => {
    const clearCart = jest.fn(async () => undefined);
    const onClosePayment = jest.fn();

    render(
      <CheckoutCryptoPaymentModal
        clearCart={clearCart as never}
        colors={Colors.light}
        cryptoPayment={{
          orderId: 'order-1',
          orderNumber: 'BAC-001',
          address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
          chain: 'TRX',
          currency: 'USDT',
          amount: 575000,
          cryptoAmount: '5.0',
          confirmationTime: '10 minutes',
          reference: 'jw-ref-1',
          paymentId: 'pay-1',
          trackingToken: 'track-1',
        }}
        onChangeSelection={jest.fn()}
        onClosePayment={onClosePayment}
      />
    );

    await act(async () => {
      fireEvent.press(screen.getByText("I've Sent the Payment"));
    });

    // Settlement polling consumes the durable completion claim on the
    // success route: without the reference the deferred conversion
    // cannot be reconciled to the Juicyway attempt.
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(onClosePayment).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        paymentMethod: 'juicyway',
        reference: 'jw-ref-1',
        trackingToken: 'track-1',
      },
    });
  });
});
