import type { OrderResponse } from '@/services/orders';
import type { CheckoutPaymentCompletionOutcome } from '@/services/track-checkout-payment-completed-once';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

const mockTrackCheckoutPaymentCompletedOnce = jest.fn(
  async (_input: unknown): Promise<CheckoutPaymentCompletionOutcome> =>
    'emitted'
);
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: (input: unknown) =>
    mockTrackCheckoutPaymentCompletedOnce(input),
}));

const mockClearAndPersistCheckoutCart = jest.fn(
  async (clearCart: () => void | Promise<void>) => {
    await clearCart();
  }
);
jest.mock('./checkout-cart-persistence', () => ({
  clearAndPersistCheckoutCart: (clearCart: () => void | Promise<void>) =>
    mockClearAndPersistCheckoutCart(clearCart),
}));

let routeStoreCreditSuccess: typeof import('./checkout-fully-paid-routing')['routeStoreCreditSuccess'];
let routeFullyPaidPrizeSuccess: typeof import('./checkout-fully-paid-routing')['routeFullyPaidPrizeSuccess'];

beforeAll(async () => {
  ({ routeStoreCreditSuccess, routeFullyPaidPrizeSuccess } = await import(
    './checkout-fully-paid-routing'
  ));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('routeStoreCreditSuccess', () => {
  it('clears the cart and routes to success with wallet/savings amounts', async () => {
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const orderResponse = {
      amountDueToGateway: 0,
      order: { payment_status: 'paid', total: 25000 },
      savings: { amountUsed: 3000 },
      wallet: { amountUsed: 22000 },
    } as unknown as OrderResponse;

    await routeStoreCreditSuccess({
      clearCart,
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderResponse,
      paymentMethod: 'wallet',
      setIsProcessing,
      trackingToken: 'tok',
    });

    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      paymentMethod: 'wallet',
      value: 25000,
    });
    expect(clearCart).toHaveBeenCalled();
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'wallet',
        savingsAmountUsed: '3000',
        walletAmountUsed: '22000',
        trackingToken: 'tok',
      }),
    });
  });

  it('retries a released claim once before leaving checkout', async () => {
    mockTrackCheckoutPaymentCompletedOnce
      .mockResolvedValueOnce('released')
      .mockResolvedValueOnce('emitted');
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const orderResponse = {
      amountDueToGateway: 0,
      order: { payment_status: 'paid', total: 25000 },
      savings: { amountUsed: 3000 },
      wallet: { amountUsed: 22000 },
    } as unknown as OrderResponse;

    await routeStoreCreditSuccess({
      clearCart,
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderResponse,
      paymentMethod: 'wallet',
      setIsProcessing,
      trackingToken: 'tok',
    });

    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenNthCalledWith(2, {
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      paymentMethod: 'wallet',
      value: 25000,
    });
    expect(clearCart).toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({ orderId: 'order-1' }),
    });
  });

  it('skips cart clear and navigation when unmounted during tracking', async () => {
    let resolveTracking: (outcome: CheckoutPaymentCompletionOutcome) => void =
      () => {};
    mockTrackCheckoutPaymentCompletedOnce.mockImplementationOnce(
      () =>
        new Promise<CheckoutPaymentCompletionOutcome>((resolve) => {
          resolveTracking = resolve;
        })
    );
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const isMountedRef = { current: true };
    const orderResponse = {
      amountDueToGateway: 0,
      order: { payment_status: 'paid', total: 25000 },
      savings: { amountUsed: 3000 },
      wallet: { amountUsed: 22000 },
    } as unknown as OrderResponse;

    const pending = routeStoreCreditSuccess({
      clearCart,
      isMountedRef,
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderResponse,
      paymentMethod: 'wallet',
      setIsProcessing,
      trackingToken: 'tok',
    });
    isMountedRef.current = false;
    resolveTracking('emitted');
    await pending;

    expect(clearCart).not.toHaveBeenCalled();
    expect(setIsProcessing).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

describe('routeFullyPaidPrizeSuccess', () => {
  it('clears the cart, releases the in-flight lock, and routes to success', async () => {
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const isOrderInFlight = { current: true };

    await routeFullyPaidPrizeSuccess({
      clearCart,
      isOrderInFlight,
      orderId: 'order-9',
      orderNumber: 'BAC-009',
      orderTotal: 19000,
      setIsProcessing,
      trackingToken: null,
    });

    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith({
      orderId: 'order-9',
      orderNumber: 'BAC-009',
      paymentMethod: 'quiz_voucher',
      value: 19000,
    });
    expect(clearCart).toHaveBeenCalled();
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(isOrderInFlight.current).toBe(false);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-9',
        orderNumber: 'BAC-009',
        // Prize success always reports the voucher method.
        paymentMethod: 'quiz_voucher',
      }),
    });
    // No trackingToken key when null.
    const params = mockRouterReplace.mock.calls[0][0].params;
    expect(params).not.toHaveProperty('trackingToken');
  });

  it('retries a released claim once before leaving checkout', async () => {
    mockTrackCheckoutPaymentCompletedOnce
      .mockResolvedValueOnce('released')
      .mockResolvedValueOnce('emitted');
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const isOrderInFlight = { current: true };

    await routeFullyPaidPrizeSuccess({
      clearCart,
      isOrderInFlight,
      orderId: 'order-9',
      orderNumber: 'BAC-009',
      orderTotal: 19000,
      setIsProcessing,
      trackingToken: null,
    });

    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutPaymentCompletedOnce).toHaveBeenNthCalledWith(2, {
      orderId: 'order-9',
      orderNumber: 'BAC-009',
      paymentMethod: 'quiz_voucher',
      value: 19000,
    });
    expect(clearCart).toHaveBeenCalled();
    expect(isOrderInFlight.current).toBe(false);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({ orderId: 'order-9' }),
    });
  });

  it('skips cart clear and navigation when unmounted during tracking', async () => {
    let resolveTracking: (outcome: CheckoutPaymentCompletionOutcome) => void =
      () => {};
    mockTrackCheckoutPaymentCompletedOnce.mockImplementationOnce(
      () =>
        new Promise<CheckoutPaymentCompletionOutcome>((resolve) => {
          resolveTracking = resolve;
        })
    );
    const clearCart = jest.fn();
    const setIsProcessing = jest.fn();
    const isMountedRef = { current: true };
    const isOrderInFlight = { current: true };

    const pending = routeFullyPaidPrizeSuccess({
      clearCart,
      isMountedRef,
      isOrderInFlight,
      orderId: 'order-9',
      orderNumber: 'BAC-009',
      orderTotal: 19000,
      setIsProcessing,
      trackingToken: null,
    });
    isMountedRef.current = false;
    resolveTracking('emitted');
    await pending;

    expect(clearCart).not.toHaveBeenCalled();
    expect(setIsProcessing).not.toHaveBeenCalled();
    expect(isOrderInFlight.current).toBe(true);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});
