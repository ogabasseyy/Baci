import './checkout-payment-finalization.test-utils';
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  createOrderResponse,
  mockClearAndPersistCheckoutCart,
  mockFetch,
  mockRouterPush,
  mockRouterReplace,
  mockStartWalletFundedBankTransferCheckout,
} from './checkout-payment-finalization.test-utils';

let finalizeCheckoutPayment: typeof import('./checkout-payment-finalization')['finalizeCheckoutPayment'];

const mockTrackCheckoutPaymentStarted = jest.fn();
const mockTrackCheckoutPaymentCompletedOnce = jest.fn(
  async (_input: unknown) => true
);
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: (input: unknown) =>
    mockTrackCheckoutPaymentCompletedOnce(input),
  trackCheckoutPaymentStarted: (...args: unknown[]) =>
    mockTrackCheckoutPaymentStarted(...args),
}));

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
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      paymentMethod: 'paystack',
      reference: 'pay-ref',
      value: 25000,
    });
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('skips payment start when gateway initialization fails', async () => {
    const setIsProcessing = jest.fn();
    const runPostOrderSideEffects = jest.fn();
    const isOrderInFlight = { current: true };
    mockFetch.mockResolvedValue({
      json: async () => ({ error: 'gateway down', success: false }),
      ok: true,
    } as Response);

    await expect(
      finalizeCheckoutPayment({
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
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_INIT_ERROR' });

    expect(mockTrackCheckoutPaymentStarted).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(runPostOrderSideEffects).not.toHaveBeenCalled();
  });

  it('stamps wallet-funded starts with each created intent id', async () => {
    // An expired intent recreated for the same order: each start must
    // carry its own intent so completions reconcile per attempt.
    mockStartWalletFundedBankTransferCheckout
      .mockResolvedValueOnce('intent-1')
      .mockResolvedValueOnce('intent-2');
    const finalizeParams = {
      clearCart: jest.fn<() => void | Promise<void>>(),
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse(),
      runPostOrderSideEffects: jest.fn(),
      selectedPayment: 'bank_transfer' as const,
      setIsProcessing: jest.fn(),
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: true,
    };

    await finalizeCheckoutPayment({
      ...finalizeParams,
      isOrderInFlight: { current: true },
    });
    await finalizeCheckoutPayment({
      ...finalizeParams,
      isOrderInFlight: { current: true },
    });

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'bank_transfer',
        reference: 'intent-1',
      })
    );
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'bank_transfer',
        reference: 'intent-2',
      })
    );
  });

  it('records the full order total on wallet-funded starts under partial credit', async () => {
    // Savings covered all but 750 of the 5750 order: the intent funds
    // the residual, but started revenue is the whole order.
    mockStartWalletFundedBankTransferCheckout.mockResolvedValueOnce('intent-1');

    await finalizeCheckoutPayment({
      clearCart: jest.fn<() => void | Promise<void>>(),
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      isOrderInFlight: { current: true },
      orderNumber: 'BAC-001',
      orderResponse: createOrderResponse({
        amountDueToGateway: 750,
        order: {
          id: 'order-1',
          payment_status: 'pending',
          tracking_token: 'tracking-token',
          total: 5750,
        },
      }),
      runPostOrderSideEffects: jest.fn(),
      selectedPayment: 'bank_transfer' as const,
      setIsProcessing: jest.fn(),
      setPendingOrder: jest.fn(),
      setShowCryptoSelection: jest.fn(),
      shouldCreateWalletFundedBankTransferOrder: true,
    });

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'bank_transfer',
        reference: 'intent-1',
        value: 5750,
      })
    );
  });

  it('requires persisted summary review before REDVAULT initialization', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        authorization_url: 'https://checkout.example.com',
        reference: 'redvault-ref',
        success: true,
      }),
      ok: true,
    } as Response);

    await expect(
      finalizeCheckoutPayment({
        clearCart: jest.fn<() => void | Promise<void>>(),
        customerEmail: 'ada@example.com',
        customerName: 'Ada Customer',
        customerPhone: '08012345678',
        isOrderInFlight: { current: true },
        orderNumber: 'BAC-UBA-001',
        orderResponse: createOrderResponse(),
        runPostOrderSideEffects: jest.fn(),
        selectedPayment: 'uba_redvault',
        setIsProcessing: jest.fn(),
        setPendingOrder: jest.fn(),
        setShowCryptoSelection: jest.fn(),
        shouldCreateWalletFundedBankTransferOrder: false,
      })
    ).rejects.toMatchObject({ code: 'REDVAULT_REVIEW_REQUIRED' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
