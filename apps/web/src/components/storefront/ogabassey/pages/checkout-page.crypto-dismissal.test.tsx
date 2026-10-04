import { afterEach, vi } from 'vitest';

const { dismissCryptoModal } = vi.hoisted(() => ({
  dismissCryptoModal: vi.fn(),
}));

vi.mock('./checkout/hooks/use-juicyway-payment', () => ({
  useJuicywayPayment: () => ({
    cryptoPaymentData: {
      address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
      chain: 'TRX',
      currency: 'USDT',
      amount: 1250,
      confirmation_time: '10 minutes',
      orderId: 'order-close-test',
      reference: 'ref-close-test',
      sessionId: 'session-close-test',
      paymentId: 'payment-close-test',
    },
    setCryptoPaymentData: vi.fn(),
    isVerifyingCrypto: false,
    cryptoVerificationStatus: 'idle',
    isInitializingCrypto: false,
    initializeCryptoPayment: vi.fn(),
    verifyCryptoPayment: vi.fn(),
    dismissCryptoModal,
    cancelCryptoInitialization: vi.fn(),
  }),
}));

import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  render,
  screen,
} from './checkout-page-test-support';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('dismisses directly from the header without asking for confirmation', () => {
  const confirmMock = vi.fn();
  vi.stubGlobal('confirm', confirmMock);

  render(<CheckoutPage />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Close crypto payment modal' })
  );

  expect(dismissCryptoModal).toHaveBeenCalledOnce();
  expect(confirmMock).not.toHaveBeenCalled();
});

it('requires confirmation from the order-status close action', () => {
  const confirmMock = vi.fn().mockReturnValue(false);
  vi.stubGlobal('confirm', confirmMock);

  render(<CheckoutPage />);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Close and check order status later',
    })
  );

  expect(confirmMock).toHaveBeenCalledWith(
    "Are you sure you want to close? If you've already sent payment, your order will still be processed once the payment is detected."
  );
  expect(dismissCryptoModal).not.toHaveBeenCalled();

  confirmMock.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Close and check order status later',
    })
  );

  expect(dismissCryptoModal).toHaveBeenCalledOnce();
});
