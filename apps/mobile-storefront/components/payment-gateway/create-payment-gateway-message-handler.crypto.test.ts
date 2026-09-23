import { jest } from '@jest/globals';
import { router } from 'expo-router';
import {
  createHandler,
  sendMessage,
} from './create-payment-gateway-message-handler.test-utils';
import { PAYMENT_KINDS } from './payment-gateway.helpers';

const mockTrackCheckoutPaymentCompletedOnce = jest.fn(
  async (_input: unknown) => true
);
const mockTrackOrderCompleted = jest.fn();

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: (input: unknown) =>
    mockTrackCheckoutPaymentCompletedOnce(input),
  trackOrderCompleted: (...args: unknown[]) => mockTrackOrderCompleted(...args),
}));

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

function mockPaidCryptoVerification(total = 49875) {
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
          id: 'order-123',
          order_number: 'ORD-123',
          payment_status: 'paid',
          subtotal: 45000,
          shipping_cost: 1500,
          discount_amount: 0,
          total,
        },
        customer: {
          name: 'Guest Buyer',
          email: 'guest@example.com',
          phone: '+2348098765432',
        },
        items: [
          {
            id: 'line-1',
            product_id: 'prod-1',
            product_name: 'Jar',
            quantity: 2,
            unit_price: 22500,
            total_price: 45000,
            product_image: null,
          },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

function mockPendingCryptoVerification() {
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
          id: 'order-123',
          order_number: 'ORD-123',
          payment_status: 'pending',
          total: 49875,
        },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

describe('createPaymentGatewayMessageHandler crypto success', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackCheckoutPaymentCompletedOnce.mockReset();
    mockPaidCryptoVerification();
  });
  it('routes crypto success with sanitized fallback params', async () => {
    const {
      clearCart,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({ trackingToken: 'track-token-123' });

    await sendMessage(handler, { type: 'crypto_success' });

    expect(markPaymentCompletionStarted).toHaveBeenCalledTimes(1);
    expect(setSuccessStatus).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(scheduleDelayedNavigation).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    expect(scheduledNavigation).toBeDefined();
    scheduledNavigation?.();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('preserves tracking token when routing order crypto success', async () => {
    const { handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: ' track-token-123 ',
    });

    await sendMessage(handler, { type: 'crypto_success' });

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('ignores duplicate crypto success messages after completion starts', async () => {
    const markPaymentCompletionStarted = jest
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const { clearCart, handler, setSuccessStatus } = createHandler({
      markPaymentCompletionStarted,
      trackingToken: 'track-token-123',
    });

    await sendMessage(handler, { type: 'crypto_success' });
    await sendMessage(handler, { type: 'crypto_success' });

    expect(markPaymentCompletionStarted).toHaveBeenCalledTimes(2);
    expect(setSuccessStatus).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith({
      customerEmail: 'guest@example.com',
      customerPhone: '+2348098765432',
      items: [expect.objectContaining({ product_id: 'prod-1', quantity: 2 })],
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      paymentMethod: 'crypto',
      reference: 'ref-123',
      shipping: 1500,
      subtotal: 45000,
      tax: 3375,
      value: 49875,
    });
  });

  it('consumes the claim with guest attribution, shipping, and VAT', async () => {
    // Arrange: a guest Juicyway checkout whose tracked order is already
    // paid (total = 45000 subtotal + 1500 shipping + 3375 VAT).
    const { handler } = createHandler({
      amount: 5000,
      gateway: 'juicyway',
      orderTotal: 49875,
      trackingToken: 'track-token-123',
    });

    // Act
    await sendMessage(handler, { type: 'crypto_success' });

    // Assert: the durable claim keeps the checkout identity and breakdown.
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348098765432',
        items: [expect.objectContaining({ product_id: 'prod-1', quantity: 2 })],
        orderId: 'order-123',
        paymentMethod: 'juicyway',
        shipping: 1500,
        subtotal: 45000,
        tax: 3375,
        value: 49875,
      })
    );
  });

  it('keeps the error path when crypto verification definitively fails', async () => {
    // Arrange: pending tracked order, but the reference cannot settle.
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/api/payments/verify')) {
        return new Response(
          JSON.stringify({
            success: true,
            status: 'failed',
            finalizationOutcome: 'cancelled',
            orderId: 'order-123',
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            payment_status: 'pending',
            total: 49875,
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const {
      clearCart,
      handler,
      onTerminalVerificationFailure,
      scheduleDelayedNavigation,
    } = createHandler({ trackingToken: 'track-token-123' });

    // Act
    await sendMessage(handler, { type: 'crypto_success' });

    // Assert: no conversion, no cart clear, no success navigation — the
    // error/retry path owns the terminal outcome.
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(onTerminalVerificationFailure).toHaveBeenCalledWith('failed');
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('routes crypto success to reconciliation when the order was cancelled', async () => {
    // Arrange: captured money, but the finalizer left no active order.
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/api/payments/verify')) {
        return new Response(
          JSON.stringify({
            success: true,
            status: 'success',
            finalizationOutcome: 'order_cancelled',
            orderId: 'order-123',
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            payment_status: 'pending',
            total: 49875,
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const { clearCart, handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: 'track-token-123',
    });

    // Act
    await sendMessage(handler, { type: 'crypto_success' });

    // Assert: no conversion, cart intact, and the success route carries
    // the reconciliation outcome for its dedicated state.
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).toHaveBeenCalledTimes(1);
    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-123',
        reconciliation: 'order_cancelled',
      }),
    });
  });

  it('keeps a new cart when the shopper leaves during crypto verification', async () => {
    // Arrange: the screen unmounts while the verification/tracking
    // awaits are in flight.
    const isMountedRef = { current: true };
    mockTrackCheckoutPaymentCompletedOnce.mockImplementationOnce(async () => {
      isMountedRef.current = false;
      return true;
    });
    const { clearCart, handler } = createHandler({
      trackingToken: 'track-token-123',
      isMountedRef,
    });

    // Act
    await sendMessage(handler, { type: 'crypto_success' });

    // Assert: the paid conversion is still recorded, but the stale
    // handler must not erase the cart built since unmounting.
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
    expect(clearCart).not.toHaveBeenCalled();
  });

  it('skips the conversion when crypto settlement is still pending', async () => {
    // Arrange: a crypto callback whose order is not paid yet.
    mockPendingCryptoVerification();
    const { clearCart, handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: 'track-token-123',
    });

    // Act
    await sendMessage(handler, { type: 'crypto_success' });

    // Assert: no paid conversion, but the shopper still reaches success
    // (settlement polling may complete the order once the webhook lands).
    expect(mockTrackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(scheduleDelayedNavigation).toHaveBeenCalledTimes(1);
    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/order-success' })
    );
  });

  it('reports the canonical order total for crypto success', async () => {
    // Arrange: the paid tracked order carries the breakdown but no total,
    // so the claim falls back to the canonical order total (not the
    // gateway residual after wallet/savings credits).
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              payment_status: 'paid',
              subtotal: 20000,
              shipping_cost: 1500,
              discount_amount: 0,
            },
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const { handler } = createHandler({
      amount: 5000,
      orderTotal: 21500,
      trackingToken: 'track-token-123',
    });

    await sendMessage(handler, { type: 'crypto_success' });

    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-123',
        reference: 'ref-123',
        subtotal: 20000,
        shipping: 1500,
        value: 21500,
      })
    );
  });

  it('omits whitespace-only tracking token when routing order crypto success', async () => {
    const { handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: '   ',
    });

    await sendMessage(handler, { type: 'crypto_success' });

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
      },
    });
  });

  it('confirms VTU crypto success before routing to the utility result screen', () => {
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      gateway: 'juicyway',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      amount: '2750',
      customerIdentifier: ' 1234567890 ',
      reference: ' crypto-ref ',
      type: 'crypto_success',
    });

    expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
    expect(setSuccessStatus).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(confirmVtuPaymentSuccess).toHaveBeenCalledWith({
      amount: 2750,
      customerIdentifier: '1234567890',
      reference: 'crypto-ref',
    });
  });

  it('falls back to route params when confirming VTU crypto success', () => {
    const { confirmVtuPaymentSuccess, handler } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      type: 'crypto_success',
    });

    expect(confirmVtuPaymentSuccess).toHaveBeenCalledWith({
      amount: 2500,
      customerIdentifier: '43901766923',
      reference: 'VTU-123',
    });
  });

  it('does not mark VTU crypto success as confirmed before backend confirmation', async () => {
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      type: 'crypto_success',
    });

    expect(confirmVtuPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
    expect(setSuccessStatus).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not route VTU crypto success without required route context', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 0,
      paymentKind: PAYMENT_KINDS.VTU,
      reference: undefined,
      utilityType: undefined,
    });

    try {
      await sendMessage(handler, { type: 'crypto_success' });

      expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
      expect(confirmVtuPaymentSuccess).not.toHaveBeenCalled();
      expect(setSuccessStatus).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to route VTU crypto payment success:',
        {
          amount: 0,
          hasReference: false,
          hasUtilityType: false,
        }
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not route order crypto success without order id or reference', () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {
      clearCart,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      orderId: undefined,
      reference: undefined,
    });

    try {
      sendMessage(handler, {
        orderId: ' ',
        reference: ' ',
        type: 'crypto_success',
      });

      expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
      expect(setSuccessStatus).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to route crypto payment success:',
        {
          hasOrderId: false,
          hasReference: false,
        }
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not swallow handler errors after a valid message is parsed', async () => {
    const { handler, setSuccessStatus } = createHandler();
    const failure = new Error('status failed');
    setSuccessStatus.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      sendMessage(handler, { type: 'crypto_success' })
    ).rejects.toThrow(failure);
  });
});
