import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { createPaymentGatewayCompletionHandlers } from './payment-gateway-completion-handlers';
import type {
  PaymentGatewayRefs,
  PaymentGatewayStatus,
} from './payment-gateway-controller.types';

const mockBeginWalletTopUpCompletion = jest.fn();
const mockBeginSavingsAuthorizationCompletion = jest.fn();
const mockHandleVtuConfirmation = jest.fn();
const mockTrackCheckoutPaymentCompletedOnce = jest.fn(
  async (_input: unknown) => true
);
const mockVerifyRedvaultPayment =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: (input: unknown) =>
    mockTrackCheckoutPaymentCompletedOnce(input),
}));

jest.mock('./payment-gateway-completions', () => ({
  beginWalletTopUpCompletion: (...args: unknown[]) =>
    mockBeginWalletTopUpCompletion(...args),
  beginSavingsAuthorizationCompletion: (...args: unknown[]) =>
    mockBeginSavingsAuthorizationCompletion(...args),
}));

jest.mock('./use-vtu-payment-completion', () => ({
  handleVtuConfirmation: (...args: unknown[]) =>
    mockHandleVtuConfirmation(...args),
}));

jest.mock('@/services/redvault', () => ({
  verifyRedvaultPayment: (...args: unknown[]) =>
    mockVerifyRedvaultPayment(...args),
}));

const mockLoadRedvaultPurchaseTrackingContext =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockClaimCheckoutPurchaseTracking =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockClearRedvaultPurchaseTrackingContext =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockTrackCheckoutRoutePurchaseCompleted = jest.fn();

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: (...args: unknown[]) =>
    mockClaimCheckoutPurchaseTracking(...args),
}));

jest.mock('@/lib/redvault-purchase-tracking-context', () => ({
  clearRedvaultPurchaseTrackingContext: (...args: unknown[]) =>
    mockClearRedvaultPurchaseTrackingContext(...args),
  loadRedvaultPurchaseTrackingContext: (...args: unknown[]) =>
    mockLoadRedvaultPurchaseTrackingContext(...args),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePurchaseCompleted: (...args: unknown[]) =>
    mockTrackCheckoutRoutePurchaseCompleted(...args),
}));

const mockClearPersistedRedvaultOrderWithRetry =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/pending-redvault-order', () => ({
  clearPersistedRedvaultOrderWithRetry: (...args: unknown[]) =>
    mockClearPersistedRedvaultOrderWithRetry(...args),
}));

function createRefs(
  status: PaymentGatewayStatus = 'ready'
): PaymentGatewayRefs {
  return {
    copiedGatewayTextRef: { current: null },
    isMountedRef: { current: true },
    loadTimeoutRef: { current: null },
    navigationTimeoutRef: { current: null },
    paymentCompletionStartedRef: { current: false },
    savingsAuthorizationAbortRef: { current: null },
    statusRef: { current: status },
    vtuConfirmationTokenRef: { current: 0 },
    webViewRef: { current: null },
  } as unknown as PaymentGatewayRefs;
}

function createInput(
  overrides: Record<string, unknown> = {},
  status: PaymentGatewayStatus = 'ready'
) {
  const refs = createRefs(status);
  return {
    refs,
    input: {
      amount: 5000,
      clearCart: jest.fn<() => void | Promise<void>>(),
      clearPendingLoadTimeout: jest.fn(),
      customerIdentifier: '08012345678',
      gateway: 'paystack' as const,
      merchantId: 'merchant-1',
      merchantSlug: 'demo',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentKind: 'order' as const,
      queryClient: {} as QueryClient,
      reference: 'ref-1',
      refs,
      returnTo: undefined,
      scheduleDelayedNavigation: jest.fn((navigate: () => void) => navigate()),
      setErrorMessage: jest.fn(),
      setPaymentStatus: jest.fn(),
      trackingToken: 'track-1',
      utilityType: undefined,
      ...overrides,
    },
  };
}

function mockPaidVerification(total = 5000) {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/payments/verify')) {
      return new Response(
        JSON.stringify({
          success: true,
          status: 'success',
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderTotal: total,
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        order: {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'paid',
          subtotal: 45000,
          shipping_cost: 1500,
          discount_amount: 0,
          total,
        },
        customer: {
          name: 'Ada Buyer',
          email: 'ada@example.com',
          phone: '+2348123456789',
        },
        items: [
          {
            id: 'line-1',
            product_id: 'prod-1',
            product_name: 'Jar',
            quantity: 1,
            unit_price: 45000,
            total_price: 45000,
            product_image: null,
          },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

function mockTerminalVerification() {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/payments/verify')) {
      return new Response(
        JSON.stringify({
          success: true,
          status: 'cancelled',
          finalizationOutcome: 'cancelled',
          orderId: 'order-1',
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        order: {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          total: 5000,
        },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

function mockReconciliationVerification(
  outcome: 'order_cancelled' | 'order_skipped' = 'order_cancelled'
) {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/payments/verify')) {
      return new Response(
        JSON.stringify({
          success: true,
          status: 'success',
          finalizationOutcome: outcome,
          orderId: 'order-1',
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        order: {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          total: 5000,
        },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

function mockPendingVerification() {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/payments/verify')) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'pending',
          error: 'still pending',
        }),
        { status: 400 }
      );
    }
    return new Response(
      JSON.stringify({
        order: {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          total: 5000,
        },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

describe('createPaymentGatewayCompletionHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaidVerification();
    mockLoadRedvaultPurchaseTrackingContext.mockResolvedValue(null);
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(false);
    mockClearRedvaultPurchaseTrackingContext.mockResolvedValue(undefined);
    mockClearPersistedRedvaultOrderWithRetry.mockResolvedValue(undefined);
  });

  it('keeps a held REDVAULT payment pending without clearing the cart or routing to success', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('pending');
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    await beginPaymentCompletion();

    expect(mockVerifyRedvaultPayment).toHaveBeenCalledWith('ref-1');
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('pending');
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('completes REDVAULT only after successful server verification', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('success');
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('success');
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/order-success' })
    );
  });

  it('clears the persisted REDVAULT fence after verified success', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('success');
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(mockClearPersistedRedvaultOrderWithRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the persisted REDVAULT fence while verification is pending', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('pending');
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(mockClearPersistedRedvaultOrderWithRetry).not.toHaveBeenCalled();
  });

  it('still completes REDVAULT success when fence cleanup rejects', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('success');
    mockClearPersistedRedvaultOrderWithRetry.mockRejectedValue(
      new Error('storage full')
    );
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('success');
    expect(input.setErrorMessage).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/order-success' })
    );
  });

  it('still runs purchase analytics when fence cleanup rejects', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue({ orderNumber: 'ORD-9' });
    mockClearPersistedRedvaultOrderWithRetry.mockRejectedValue(
      new Error('storage full')
    );
    mockLoadRedvaultPurchaseTrackingContext.mockResolvedValue({
      items: [],
      orderNumber: 'ORD-9',
      paymentMethod: 'uba_redvault',
      shipping: 0,
      subtotal: 5000,
      tax: 0,
      total: 5000,
    });
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(true);
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(mockLoadRedvaultPurchaseTrackingContext).toHaveBeenCalledWith(
      'order-1'
    );
    expect(mockTrackCheckoutRoutePurchaseCompleted).toHaveBeenCalledTimes(1);
    expect(mockClearRedvaultPurchaseTrackingContext).toHaveBeenCalledWith(
      'order-1'
    );
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('success');
  });

  it('clears saved REDVAULT context without re-emitting when the purchase claim is taken', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue({ orderNumber: 'ORD-9' });
    mockLoadRedvaultPurchaseTrackingContext.mockResolvedValue({
      items: [],
      orderNumber: 'ORD-9',
      paymentMethod: 'uba_redvault',
      shipping: 0,
      subtotal: 5000,
      tax: 0,
      total: 5000,
    });
    // Another path already recorded the conversion: no fresh claim, so no
    // emission — but the saved email/phone/items must not linger.
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(false);
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(mockTrackCheckoutRoutePurchaseCompleted).not.toHaveBeenCalled();
    expect(mockClearRedvaultPurchaseTrackingContext).toHaveBeenCalledWith(
      'order-1'
    );
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('success');
  });

  it('preserves the cart when REDVAULT verification rejects', async () => {
    mockVerifyRedvaultPayment.mockRejectedValue(new Error('offline'));
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('pending');
    expect(input.setErrorMessage).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('still completes REDVAULT success when tracking cleanup rejects', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue({ orderNumber: 'ORD-9' });
    mockLoadRedvaultPurchaseTrackingContext.mockResolvedValue({
      items: [],
      orderNumber: 'ORD-9',
      paymentMethod: 'uba_redvault',
      shipping: 0,
      subtotal: 5000,
      tax: 0,
      total: 5000,
    });
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(true);
    mockClearRedvaultPurchaseTrackingContext.mockRejectedValue(
      new Error('storage full')
    );
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    await createPaymentGatewayCompletionHandlers(
      input
    ).beginPaymentCompletion();
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('success');
    expect(input.setErrorMessage).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/order-success' })
    );
  });

  it('distinguishes explicit held capture from pending verification', async () => {
    mockVerifyRedvaultPayment.mockResolvedValue('held');
    const { input } = createInput({ paymentMethod: 'uba_redvault' });
    const handler = createPaymentGatewayCompletionHandlers(input);
    await handler.beginPaymentCompletion();
    await handler.beginPaymentCompletion();
    expect(input.setPaymentStatus).toHaveBeenLastCalledWith('held');
    expect(mockVerifyRedvaultPayment).toHaveBeenCalledTimes(1);
    expect(input.clearCart).not.toHaveBeenCalled();
  });

  it('completes an order payment, clears the cart, and navigates to success', async () => {
    // Arrange
    const { input, refs } = createInput();
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert
    expect(refs.paymentCompletionStartedRef.current).toBe(true);
    expect(input.clearPendingLoadTimeout).toHaveBeenCalledTimes(1);
    expect(input.setPaymentStatus).toHaveBeenCalledWith('success');
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', value: 5000 })
    );
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/order-success',
        params: expect.objectContaining({
          orderId: 'order-1',
          orderNumber: 'ORD-1',
          paymentMethod: 'paystack',
          reference: 'ref-1',
          trackingToken: 'track-1',
        }),
      })
    );
  });

  it('forwards tracked identity, breakdown, and items on direct completion', async () => {
    // Arrange: the server already marks the order paid (total = 45000 +
    // 1500 shipping + 3375 VAT).
    mockPaidVerification(49875);
    const { input } = createInput({ amount: 5000, orderTotal: 49875 });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert: the durable claim is consumed with full attribution.
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'ada@example.com',
        customerPhone: '+2348123456789',
        items: [expect.objectContaining({ product_id: 'prod-1', quantity: 1 })],
        orderId: 'order-1',
        shipping: 1500,
        subtotal: 45000,
        tax: 3375,
        value: 49875,
      })
    );
  });

  it('reports the canonical order total instead of the gateway residual', async () => {
    // Arrange
    mockPaidVerification(21500);
    const { input } = createInput({ amount: 5000, orderTotal: 21500 });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        value: 21500,
      })
    );
  });

  it('skips the conversion when server verification is still pending', async () => {
    // Arrange: a matching-reference redirect whose order is not paid yet.
    mockPendingVerification();
    const { input } = createInput();
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert: no paid conversion, but the shopper still reaches success
    // (settlement polling may complete the order once the webhook lands).
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/order-success' })
    );
  });

  it('keeps the error path when verification definitively cancels', async () => {
    // Arrange: pending tracked order, but the reference cannot settle.
    mockTerminalVerification();
    const { input, refs } = createInput();
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert: no conversion, no cart clear, no success navigation — the
    // error message shows and completion can be retried.
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(input.setPaymentStatus).toHaveBeenCalledWith('error');
    expect(input.setErrorMessage).toHaveBeenCalledWith(
      'Payment was cancelled before completion. You can try again.'
    );
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(refs.paymentCompletionStartedRef.current).toBe(false);
  });

  it.each([
    { outcome: 'order_cancelled' },
    { outcome: 'order_skipped' },
  ])('routes a captured $outcome payment to reconciliation, not confirmation', async ({
    outcome,
  }) => {
    // Arrange: captured money, but the finalizer left no active order.
    mockReconciliationVerification(
      outcome as 'order_cancelled' | 'order_skipped'
    );
    const { input } = createInput();
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert: no conversion, cart intact, and the success route carries
    // the reconciliation outcome for its dedicated state.
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(input.setPaymentStatus).not.toHaveBeenCalledWith('error');
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-1',
        reconciliation: outcome,
      }),
    });
  });

  it('ignores a second completion once one has already started', () => {
    // Arrange
    const { input, refs } = createInput();
    refs.paymentCompletionStartedRef.current = true;
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not re-run completion when status is already success', () => {
    // Arrange
    const { input } = createInput({}, 'success');
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(input.setPaymentStatus).not.toHaveBeenCalled();
    expect(input.clearCart).not.toHaveBeenCalled();
  });

  it('delegates wallet top-ups to the wallet completion flow', () => {
    // Arrange
    const { input } = createInput({ paymentKind: 'wallet' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(mockBeginWalletTopUpCompletion).toHaveBeenCalledTimes(1);
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('delegates savings authorizations to the savings completion flow', () => {
    // Arrange
    const { input } = createInput({ paymentKind: 'savings_auth' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(mockBeginSavingsAuthorizationCompletion).toHaveBeenCalledTimes(1);
  });

  it('runs the VTU confirmation flow for utility payments', () => {
    // Arrange
    const { input, refs } = createInput({ paymentKind: 'vtu' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(refs.paymentCompletionStartedRef.current).toBe(true);
    expect(input.setPaymentStatus).toHaveBeenCalledWith('processing');
    expect(mockHandleVtuConfirmation).toHaveBeenCalledTimes(1);
  });
});
