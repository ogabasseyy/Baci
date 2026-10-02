import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPaymentExecutionOptions } from './use-checkout-payment-execution';

const mocks = vi.hoisted(() => ({
  clearIdempotencyKey: vi.fn(),
  captureCompleted: vi.fn(),
  push: vi.fn(),
  useCrypto: vi.fn(),
  useCustomer: vi.fn(),
  useDva: vi.fn(),
  useSubmission: vi.fn(),
  useTransfer: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: mocks.captureCompleted,
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: mocks.clearIdempotencyKey,
}));
vi.mock('./use-checkout-crypto-session', () => ({
  useCheckoutCryptoSession: mocks.useCrypto,
}));
vi.mock('./use-checkout-dva-session', () => ({
  useCheckoutDvaSession: mocks.useDva,
}));
vi.mock('./use-checkout-order-submission', () => ({
  useCheckoutOrderSubmission: mocks.useSubmission,
}));
vi.mock('./use-storefront-customer-session', () => ({
  useStorefrontCustomerSession: mocks.useCustomer,
}));
vi.mock('./use-wallet-funded-bank-transfer', () => ({
  useWalletFundedBankTransfer: mocks.useTransfer,
}));

import { useCheckoutCryptoSession } from './use-checkout-crypto-session';
import { useCheckoutDvaSession } from './use-checkout-dva-session';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';
import {
  useWalletFundedBankTransfer,
  type WalletFundedOrderPaidPayload,
} from './use-wallet-funded-bank-transfer';
import { useCheckoutPaymentExecution } from './use-checkout-payment-execution';

const dva = {
  closeDvaModal: vi.fn(),
  dvaData: null,
  handleDvaConfirmTransfer: vi.fn(),
  isInitializingDva: false,
  isVerifyingDva: false,
  setDvaData: vi.fn(),
  setIsInitializingDva: vi.fn(),
};
const crypto = {
  setPendingCryptoOrder: vi.fn(),
  setShowCryptoSelector: vi.fn(),
  setCryptoPaymentData: vi.fn(),
};
const walletTransfer = { start: vi.fn(), account: null, intent: null };
const handlePlaceOrder = vi.fn();
const waitForResolvedCustomerAuth = vi.fn(async () => true);

function createOptions(
  resumed: CheckoutPaymentExecutionOptions['attempt']['resumed'] = {
    order: null,
    preferredGateway: null,
    trackingToken: null,
    merchantSlugFromResume: null,
  },
  identity: CheckoutPaymentExecutionOptions['identity'] = {
    merchantId: 'merchant-1',
    merchantSlug: 'test-store',
    currencyCode: 'NGN',
  }
): CheckoutPaymentExecutionOptions {
  return {
    identity,
    form: {
      account: {
        createAccount: false,
        password: '',
        user: null,
      },
      contact: {
        customerEmail: 'ada@example.test',
        customerPhone: '+2348031234567',
        firstName: 'Ada',
        lastName: 'Okafor',
        newsletterOptIn: false,
      },
    },
    cart: {
      cart: [],
      checkoutCart: [],
      checkoutCartTotal: 5000,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
    },
    delivery: {} as unknown as CheckoutPaymentExecutionOptions['delivery'],
    merchant: null,
    navigation: {
      setCurrentStep: vi.fn(),
      setCompletedSteps: vi.fn(),
      pushSuccessRoute: vi.fn(),
      getHref: (path) => `/shop${path}`,
    },
    order: {
      pending: null,
      clearPending: vi.fn(),
      setPending: vi.fn(),
      setOrderCreated: vi.fn(),
      clearCheckoutSession: vi.fn(),
    },
    payment: {
      session: { method: 'bank_transfer' } as unknown as CheckoutPaymentExecutionOptions['payment']['session'],
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: false,
      redvaultAvailable: false,
      currencyCode: 'NGN',
    },
    attempt: {
      resumed,
      processing: {
        setIsProcessing: vi.fn(),
        isOrderInFlightRef: { current: false },
        tryBeginSubmission: vi.fn(() => true),
        releaseSubmission: vi.fn(),
        handleSubmissionError: vi.fn(),
      },
    },
  };
}

describe('useCheckoutPaymentExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDva.mockReturnValue(dva);
    mocks.useCrypto.mockReturnValue(crypto);
    mocks.useCustomer.mockReturnValue({
      waitForResolvedAuthenticated: waitForResolvedCustomerAuth,
    });
    mocks.useTransfer.mockReturnValue(walletTransfer);
    mocks.useSubmission.mockReturnValue({ handlePlaceOrder });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('composes fresh checkout resources, authenticated resolution, and overlay sessions', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useCheckoutPaymentExecution(options));
    const submission = vi.mocked(useCheckoutOrderSubmission).mock.calls[0]?.[0];

    expect(result.current.handlePlaceOrder).toBe(handlePlaceOrder);
    expect(result.current.dva).toBe(dva);
    expect(result.current.crypto).toBe(crypto);
    expect(result.current.walletFundedTransfer).toBe(walletTransfer);
    expect(vi.mocked(useStorefrontCustomerSession)).toHaveBeenCalledWith(
      'test-store'
    );
    expect(vi.mocked(useCheckoutDvaSession)).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutCart: options.cart.checkoutCart,
        currencyCode: 'NGN',
        merchantSlug: 'test-store',
      })
    );
    expect(vi.mocked(useCheckoutCryptoSession)).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        isOrderInFlightRef: options.attempt.processing.isOrderInFlightRef,
      })
    );
    expect(vi.mocked(useWalletFundedBankTransfer)).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'test-store',
      })
    );
    expect(submission?.account.waitForResolvedCustomerAuth).toBe(
      waitForResolvedCustomerAuth
    );
    expect(submission?.payment.session).toBe(options.payment.session);
    expect(submission?.order).toEqual(
      expect.objectContaining({
        setDvaData: dva.setDvaData,
        setIsInitializingDva: dva.setIsInitializingDva,
        setPendingCryptoOrder: crypto.setPendingCryptoOrder,
        setShowCryptoSelector: crypto.setShowCryptoSelector,
        setCryptoPaymentData: crypto.setCryptoPaymentData,
        walletFundedTransfer: walletTransfer,
      })
    );
    await expect(
      submission?.account.waitForResolvedCustomerAuth()
    ).resolves.toBe(true);
  });

  it('preserves resumed-order identity and routes a confirmed transfer through completion cleanup', () => {
    vi.useFakeTimers();
    const resumedOrder = {
      id: 'order-resume-1',
    } as unknown as CheckoutPaymentExecutionOptions['attempt']['resumed']['order'];
    const options = createOptions({
      order: resumedOrder,
      preferredGateway: 'credpal',
      trackingToken: 'tracking-1',
      merchantSlugFromResume: 'test-store',
    });
    const { result } = renderHook(() => useCheckoutPaymentExecution(options));
    const submission = vi.mocked(useCheckoutOrderSubmission).mock.calls[0]?.[0];
    const completion = vi.mocked(useWalletFundedBankTransfer).mock.calls[0]?.[0]
      .onOrderPaid;
    const payload: WalletFundedOrderPaidPayload = {
      checkoutFingerprint: 'fingerprint-1',
      currency: 'NGN',
      intentId: 'intent-1',
      orderId: 'order-paid-1',
      orderNumber: 'ORD-1',
      total: 5000,
      trackingToken: 'paid-track-1',
    };

    expect(submission?.resumed).toBe(options.attempt.resumed);
    expect(result.current.walletFundedTransfer).toBe(walletTransfer);
    expect(completion).toBeTypeOf('function');
    act(() => completion?.(payload));

    expect(mocks.captureCompleted).toHaveBeenCalledWith({
      currency: 'NGN',
      orderId: 'order-paid-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'bank_transfer',
      reference: 'intent-1',
      total: 5000,
    });
    expect(options.order.clearPending).toHaveBeenCalledOnce();
    expect(mocks.clearIdempotencyKey).toHaveBeenCalledWith('fingerprint-1');
    expect(options.order.clearCheckoutSession).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith(
      '/shop/order-success?orderId=order-paid-1&wallet=true&trackingToken=paid-track-1'
    );
    act(() => vi.advanceTimersByTime(500));
    expect(options.cart.clearCart).toHaveBeenCalledOnce();
  });

  it.each([null, undefined])(
    'keeps unresolved merchant identity safe and preserves submission guards (%s)',
    (merchantId) => {
      const options = createOptions(undefined, {
        merchantId,
        merchantSlug: undefined,
        currencyCode: 'NGN',
      });
      const { result } = renderHook(() => useCheckoutPaymentExecution(options));
      const submission = vi.mocked(useCheckoutOrderSubmission).mock.calls[0]?.[0];

      expect(vi.mocked(useStorefrontCustomerSession)).toHaveBeenCalledWith(undefined);
      expect(vi.mocked(useCheckoutCryptoSession)).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId })
      );
      expect(vi.mocked(useWalletFundedBankTransfer)).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId: undefined, merchantSlug: undefined })
      );
      expect(submission?.account.waitForResolvedCustomerAuth).toBe(
        waitForResolvedCustomerAuth
      );
      expect(submission?.processing).toBe(options.attempt.processing);
      expect(submission?.processing.tryBeginSubmission).toBe(
        options.attempt.processing.tryBeginSubmission
      );
      expect(submission?.processing.releaseSubmission).toBe(
        options.attempt.processing.releaseSubmission
      );
      expect(submission?.processing.handleSubmissionError).toBe(
        options.attempt.processing.handleSubmissionError
      );
      expect(result.current.handlePlaceOrder).toBe(handlePlaceOrder);
    }
  );
});
