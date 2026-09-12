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
  mockStartWalletFundedBankTransferCheckout,
} from './checkout-payment-finalization.test-utils';

let finalizeCheckoutPayment: typeof import('./checkout-payment-finalization')['finalizeCheckoutPayment'];

describe('finalizeCheckoutPayment async cart', () => {
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
