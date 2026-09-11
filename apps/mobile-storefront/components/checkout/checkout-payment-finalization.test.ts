import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { OrderResponse } from '@/services/orders';

const mockClearAndPersistCheckoutCart =
  jest.fn<(clearCart: () => void | Promise<void>) => Promise<void>>();
const mockFetch =
  jest.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockStartWalletFundedBankTransferCheckout =
  jest.fn<(params: unknown) => Promise<boolean>>();

jest.mock('expo-router', () => ({
  router: {
    push: mockRouterPush,
    replace: mockRouterReplace,
  },
}));

jest.mock('@/services/orders', () => ({
  OrderError: class OrderError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('./checkout-cart-persistence', () => ({
  clearAndPersistCheckoutCart: (clearCart: () => void | Promise<void>) =>
    mockClearAndPersistCheckoutCart(clearCart),
}));

jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.com',
  CHECKOUT_MERCHANT_ID: 'merchant-1',
}));

jest.mock('./checkout-wallet-funded-bank-transfer', () => ({
  startWalletFundedBankTransferCheckout: (params: unknown) =>
    mockStartWalletFundedBankTransferCheckout(params),
}));

let finalizeCheckoutPayment: typeof import('./checkout-payment-finalization')['finalizeCheckoutPayment'];

type OrderResponseOverrides = Omit<
  Partial<OrderResponse>,
  'order' | 'savings' | 'wallet'
> & {
  order?: Partial<OrderResponse['order']>;
  savings?: Partial<NonNullable<OrderResponse['savings']>> | null;
  wallet?: Partial<NonNullable<OrderResponse['wallet']>> | null;
};

const baseOrderResponse: OrderResponse = {
  amountDueToGateway: 25000,
  order: {
    created_at: '2026-05-30T12:00:00.000Z',
    id: 'order-1',
    order_number: 'BAC-001',
    payment_status: 'pending',
    shipping_status: 'pending',
    total: 25000,
    tracking_token: 'tracking-token',
  },
  savings: null,
  wallet: null,
};

function createOrderResponse(
  overrides: OrderResponseOverrides = {}
): OrderResponse {
  return {
    ...baseOrderResponse,
    ...overrides,
    order: {
      ...baseOrderResponse.order,
      ...overrides.order,
    },
    savings:
      overrides.savings === undefined || overrides.savings === null
        ? (overrides.savings ?? baseOrderResponse.savings)
        : {
            amountUsed: 0,
            goalId: 'goal-1',
            redemptionId: null,
            ...overrides.savings,
          },
    wallet:
      overrides.wallet === undefined || overrides.wallet === null
        ? (overrides.wallet ?? baseOrderResponse.wallet)
        : {
            amountUsed: 0,
            newBalance: 0,
            transactionId: null,
            ...overrides.wallet,
          },
  };
}

describe('finalizeCheckoutPayment', () => {
  beforeAll(async () => {
    ({ finalizeCheckoutPayment } = await import(
      './checkout-payment-finalization'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClearAndPersistCheckoutCart.mockImplementation(async (clearCart) => {
      await clearCart();
      return Promise.resolve();
    });
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('routes fully paid store-credit orders directly to order success', async () => {
    const clearCart = jest.fn<() => void | Promise<void>>();
    const setIsProcessing = jest.fn();
    const runPostOrderSideEffects = jest.fn();
    const isOrderInFlight = { current: true };

    await finalizeCheckoutPayment({
      clearCart,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight,
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse({
        amountDueToGateway: 0,
        order: {
          id: 'order-1',
          payment_status: 'paid',
          tracking_token: 'tracking-token',
        },
        wallet: { amountUsed: 25000 },
      }),
      runPostOrderSideEffects,
      selectedPayment: 'paystack',
      setIsProcessing,
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: false,
    });

    expect(clearCart).toHaveBeenCalled();
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(isOrderInFlight.current).toBe(false);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        paymentMethod: 'wallet',
        trackingToken: 'tracking-token',
        walletAmountUsed: '25000',
      }),
    });
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('routes a fully-paid ₦0 prize order to success instead of initializing a gateway', async () => {
    // A quiz prize (voucher) order is pre-reserved and comes back paid with
    // nothing due and no wallet/savings usage. Even with an online method
    // selected, it must go straight to success, not the ₦0 gateway.
    const clearCart = jest.fn<() => void | Promise<void>>();
    const setIsProcessing = jest.fn();
    const runPostOrderSideEffects = jest.fn();
    const isOrderInFlight = { current: true };

    await finalizeCheckoutPayment({
      clearCart,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight,
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse({
        amountDueToGateway: 0,
        order: {
          id: 'order-1',
          payment_status: 'paid',
          tracking_token: 'tracking-token',
        },
      }),
      runPostOrderSideEffects,
      selectedPayment: 'paystack',
      setIsProcessing,
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: false,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(clearCart).toHaveBeenCalled();
    expect(isOrderInFlight.current).toBe(false);
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: expect.objectContaining({
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        // The prize is settled by the voucher — success uses the actual method,
        // not the stale UI selection (here 'paystack').
        paymentMethod: 'quiz_voucher',
        trackingToken: 'tracking-token',
      }),
    });
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('initializes gateway payments with an idempotency key before routing and post-order side effects', async () => {
    const setIsProcessing = jest.fn();
    const runPostOrderSideEffects = jest.fn();
    const isOrderInFlight = { current: true };
    mockFetch.mockResolvedValue({
      json: async () => ({
        authorization_url: 'https://checkout.example.com',
        reference: 'pay-ref',
        success: true,
      }),
      ok: true,
    } as Response);

    await finalizeCheckoutPayment({
      clearCart: jest.fn<() => void | Promise<void>>(),
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight,
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse(),
      runPostOrderSideEffects,
      selectedPayment: 'paystack',
      setIsProcessing,
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: false,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/payments/initialize',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'payment-init-order-1-paystack',
        }),
      })
    );
    const initBody = JSON.parse(
      (mockFetch.mock.calls[0]?.[1] as RequestInit).body as string
    );
    expect(initBody).toEqual(
      expect.objectContaining({
        billing_address: { country: 'NG' },
        gateway: 'paystack',
      })
    );
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(isOrderInFlight.current).toBe(false);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        authorizationUrl: 'https://checkout.example.com',
        gateway: 'paystack',
        orderId: 'order-1',
        reference: 'pay-ref',
      }),
    });
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('uses the wallet-funded bank transfer flow when it can start', async () => {
    const runPostOrderSideEffects = jest.fn();
    mockStartWalletFundedBankTransferCheckout.mockResolvedValue(true);

    await finalizeCheckoutPayment({
      clearCart: jest.fn<() => void | Promise<void>>(),
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight: { current: true },
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse(),
      runPostOrderSideEffects,
      selectedPayment: 'bank_transfer',
      setIsProcessing: jest.fn(),
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: true,
    });

    expect(mockStartWalletFundedBankTransferCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        trackingToken: 'tracking-token',
      })
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('initializes direct bank transfer with explicit Nigerian billing country', async () => {
    const setIsProcessing = jest.fn();
    const runPostOrderSideEffects = jest.fn();
    mockFetch.mockResolvedValue({
      json: async () => ({
        dva: {
          account_name: 'Test Store / Ada Customer',
          account_number: '1234567890',
          bank_name: 'Wema Bank',
        },
        reference: 'dva-ref',
        success: true,
      }),
      ok: true,
    } as Response);

    await finalizeCheckoutPayment({
      clearCart: jest.fn<() => void | Promise<void>>(),
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight: { current: true },
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse(),
      runPostOrderSideEffects,
      selectedPayment: 'bank_transfer',
      setIsProcessing,
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: false,
    });

    const initBody = JSON.parse(
      (mockFetch.mock.calls[0]?.[1] as RequestInit).body as string
    );
    expect(initBody).toEqual(
      expect.objectContaining({
        billing_address: { country: 'NG' },
        gateway: 'paystack',
        payment_type: 'dva',
      })
    );
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        accountNumber: '1234567890',
        bankName: 'Wema Bank',
        orderId: 'order-1',
        reference: 'dva-ref',
      }),
    });
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });
});
