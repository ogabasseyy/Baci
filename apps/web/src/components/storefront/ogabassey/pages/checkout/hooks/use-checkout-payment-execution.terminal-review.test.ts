import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewedDelivery } from './terminal-redvault-review.test-support';
import { useCheckoutPaymentExecution } from './use-checkout-payment-execution';
import {
  createOptions,
  crypto,
  dva,
  handlePlaceOrder,
  walletTransfer,
} from './use-checkout-payment-execution.test-support';

const mocks = vi.hoisted(() => ({
  useCustomer: vi.fn(),
  useDva: vi.fn(),
  useCrypto: vi.fn(),
  useTransfer: vi.fn(),
  useSubmission: vi.fn(),
  useRedvault: vi.fn(),
}));

vi.mock('./use-checkout-dva-session', () => ({
  useCheckoutDvaSession: mocks.useDva,
}));
vi.mock('./use-checkout-crypto-session', () => ({
  useCheckoutCryptoSession: mocks.useCrypto,
}));
vi.mock('./use-storefront-customer-session', () => ({
  useStorefrontCustomerSession: mocks.useCustomer,
}));
vi.mock('./use-wallet-funded-bank-transfer', () => ({
  useWalletFundedBankTransfer: mocks.useTransfer,
}));
vi.mock('./use-checkout-order-submission', () => ({
  useCheckoutOrderSubmission: mocks.useSubmission,
}));
vi.mock('./use-checkout-redvault-availability', () => ({
  useCheckoutRedvaultAvailability: mocks.useRedvault,
}));
vi.mock('./use-wallet-funded-order-completion', () => ({
  useWalletFundedOrderCompletion: () => vi.fn(),
}));

function replacementCartOptions() {
  const options = createOptions();
  const { context } = reviewedDelivery('door');
  options.cart = {
    ...context.cart,
    sharedCartRef: { cartId: 'replacement-cart', version: 1 },
  };
  options.attempt.pendingCheckoutOrder = context.order.pending;
  options.payment.session = context.payment.session;
  return options;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCustomer.mockReturnValue({ waitForResolvedAuthenticated: vi.fn() });
  mocks.useDva.mockReturnValue(dva);
  mocks.useCrypto.mockReturnValue(crypto);
  mocks.useTransfer.mockReturnValue(walletTransfer);
  mocks.useSubmission.mockReturnValue({ handlePlaceOrder });
  mocks.useRedvault.mockReturnValue({ availability: { available: false } });
});

describe('terminal UBA review after cart replacement', () => {
  it('keeps the matching reviewed payment available for an empty replacement cart', () => {
    const options = replacementCartOptions();
    const { result } = renderHook(() => useCheckoutPaymentExecution(options));

    expect(result.current.redvaultAvailable).toBe(true);
    expect(
      mocks.useSubmission.mock.calls[0]?.[0].payment.redvaultAvailable
    ).toBe(true);
  });

  it('does not use a different in-memory order to enable the old review', () => {
    const options = replacementCartOptions();
    const ready = options.payment.session.redvault.orderReady;
    if (!ready) throw new Error('Missing reviewed order');
    options.payment.session.redvault.orderReady = {
      ...ready,
      orderId: 'other',
    };
    const { result } = renderHook(() => useCheckoutPaymentExecution(options));

    expect(result.current.redvaultAvailable).toBe(false);
  });
});
