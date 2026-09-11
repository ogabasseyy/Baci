import type { OrderResponse } from '@/services/orders';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
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
      order: { payment_status: 'paid' },
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
      setIsProcessing,
      trackingToken: null,
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
});
