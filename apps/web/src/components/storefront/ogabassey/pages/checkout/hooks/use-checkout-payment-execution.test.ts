import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPaymentExecutionOptions } from './use-checkout-payment-execution';
import {
  createOptions,
  crypto,
  dva,
  handlePlaceOrder,
  waitForResolvedCustomerAuth,
  walletTransfer,
} from './use-checkout-payment-execution.test-support';
import type { WalletFundedOrderPaidPayload } from './use-wallet-funded-bank-transfer';

const mocks = vi.hoisted(() => ({
  clearIdempotencyKey: vi.fn(),
  captureCompleted: vi.fn(),
  push: vi.fn(),
  useCrypto: vi.fn(),
  useCustomer: vi.fn(),
  useDva: vi.fn(),
  useRedvault: vi.fn(),
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
vi.mock('./use-checkout-redvault-availability', () => ({
  useCheckoutRedvaultAvailability: mocks.useRedvault,
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
import { useCheckoutPaymentExecution } from './use-checkout-payment-execution';
import { useCheckoutRedvaultAvailability } from './use-checkout-redvault-availability';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';
import { useWalletFundedBankTransfer } from './use-wallet-funded-bank-transfer';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDva.mockReturnValue(dva);
  mocks.useCrypto.mockReturnValue(crypto);
  mocks.useCustomer.mockReturnValue({
    waitForResolvedAuthenticated: waitForResolvedCustomerAuth,
  });
  mocks.useTransfer.mockReturnValue(walletTransfer);
  mocks.useSubmission.mockReturnValue({ handlePlaceOrder });
  mocks.useRedvault.mockReturnValue({
    availability: { available: false, reason: 'unavailable' },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCheckoutPaymentExecution', () => {
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
        isOrderInFlightRef: options.attempt.isOrderInFlightRef,
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
    } as unknown as CheckoutPaymentExecutionOptions['attempt']['resumedOrder'];
    const options = createOptions({
      resumedOrder,
      preferredGateway: 'credpal',
      resumeTrackingToken: 'tracking-1',
      resumeMerchantSlug: 'test-store',
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

    expect(submission?.resumed).toEqual({
      order: options.attempt.resumedOrder,
      preferredGateway: options.attempt.preferredGateway,
      trackingToken: options.attempt.resumeTrackingToken,
      merchantSlugFromResume: options.attempt.resumeMerchantSlug,
    });
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
    expect(options.attempt.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
    expect(mocks.clearIdempotencyKey).toHaveBeenCalledWith('fingerprint-1');
    expect(options.form.session.clear).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith(
      '/shop/order-success?orderId=order-paid-1&wallet=true&trackingToken=paid-track-1'
    );
    act(() => vi.advanceTimersByTime(500));
    expect(options.cart.clearCart).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    undefined,
  ])('keeps unresolved merchant identity safe and preserves submission guards (%s)', (merchantId) => {
    const options = createOptions(undefined, {
      merchantId,
      merchantSlug: undefined,
      currencyCode: 'NGN',
    });
    const { result } = renderHook(() => useCheckoutPaymentExecution(options));
    const submission = vi.mocked(useCheckoutOrderSubmission).mock.calls[0]?.[0];

    expect(vi.mocked(useStorefrontCustomerSession)).toHaveBeenCalledWith(
      undefined
    );
    expect(vi.mocked(useCheckoutCryptoSession)).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId })
    );
    expect(vi.mocked(useWalletFundedBankTransfer)).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: undefined,
        merchantSlug: undefined,
      })
    );
    expect(submission?.account.waitForResolvedCustomerAuth).toBe(
      waitForResolvedCustomerAuth
    );
    expect(submission?.processing.tryBeginSubmission).toBe(
      options.attempt.tryBeginSubmission
    );
    expect(submission?.processing.releaseSubmission).toBe(
      options.attempt.releaseSubmission
    );
    expect(submission?.processing.handleSubmissionError).toBe(
      options.attempt.handleSubmissionError
    );
    expect(result.current.handlePlaceOrder).toBe(handlePlaceOrder);
  });

  it('derives REDVAULT availability from the sanitized checkout cart', () => {
    const rawItem = {
      id: 'line-1',
      quantity: 1,
      price: 100,
      negotiatedPrice: 90,
    };
    const sanitizedItem = { id: 'line-1', quantity: 1, price: 100 };
    const options = createOptions();
    options.cart.cart = [rawItem] as never;
    options.cart.checkoutCart = [sanitizedItem] as never;
    mocks.useRedvault.mockReturnValue({
      availability: { available: true, reason: 'private_live_pilot' },
    });

    const { result } = renderHook(() => useCheckoutPaymentExecution(options));
    const hook = vi.mocked(useCheckoutRedvaultAvailability);
    const submission = vi.mocked(useCheckoutOrderSubmission).mock.calls[0]?.[0];

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        cartItems: options.cart.checkoutCart,
        merchantId: 'merchant-1',
        merchantSlug: 'test-store',
      })
    );
    expect(hook.mock.calls[0]?.[0].cartItems).not.toBe(options.cart.cart);
    expect(hook.mock.calls[0]?.[0].cartItems).toEqual([sanitizedItem]);
    expect(submission?.payment.redvaultAvailable).toBe(true);
    expect(result.current.redvaultAvailable).toBe(true);
  });

  it('passes pilot fee blockers from assurance, shipping, and gift state', () => {
    const options = createOptions();
    options.cart.checkoutCart = [
      { id: 'line-1', quantity: 1, hasAssurance: true },
    ] as never;
    options.delivery = {
      session: { quotes: { selected: { price: 1500 } } },
      giftWrappingCost: 500,
    } as never;

    renderHook(() => useCheckoutPaymentExecution(options));
    const hook = vi.mocked(useCheckoutRedvaultAvailability);

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        pilotFeeBlockers: {
          hasAssurance: true,
          shippingFee: 1500,
          giftWrappingCost: 500,
        },
      })
    );
  });
});
