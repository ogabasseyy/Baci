import { jest } from '@jest/globals';
import type { CreateOrderResult } from '@/services/orders.response';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { createOrSubmitCheckoutOrder } from './create-or-submit-checkout-order';
import { createSubmittedCheckoutOrder } from './create-submitted-checkout-order';

jest.mock('./checkout-bnpl-submit', () => ({
  submitBnplCheckout: jest.fn(),
}));

jest.mock('./create-submitted-checkout-order', () => ({
  createSubmittedCheckoutOrder: jest.fn(),
}));

const snapshot: CheckoutSnapshot = {
  assuranceFee: 0,
  deliveryFee: 0,
  subtotal: 20_000,
  taxAmount: 0,
  total: 20_000,
};

const address = {
  address: '12 Broad St',
  city: 'Lagos',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  state: 'Lagos',
};

describe('createOrSubmitCheckoutOrder with PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a standard order and captures its id when zero-balance or non-BNPL', async () => {
    const orderResponse: CreateOrderResult = {
      amountDueToGateway: 0,
      effectiveCheckoutGeneration: 'gen-off-1',
      order: {
        created_at: '2026-11-25T12:00:00.000Z',
        id: 'order-off-1',
        order_number: 'ORD-OFF-1',
        payment_status: 'paid',
        shipping_status: 'pending',
        total: 20_000,
      },
      wallet: null,
    };
    const mockCreate = createSubmittedCheckoutOrder as jest.MockedFunction<
      typeof createSubmittedCheckoutOrder
    >;
    mockCreate.mockResolvedValue({
      creditFields: { wallet_amount_used: 20_000 },
      orderResponse,
    });
    const onOrderCreated = jest.fn();

    const result = await createOrSubmitCheckoutOrder({
      address,
      boundItemsSnapshot: [],
      checkoutGeneration: 'gen-off-1',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      getShippingProvider: () => undefined,
      isAuthenticated: true,
      isBNPL: true,
      isOrderInFlight: { current: true },
      isVoucherOnlyCart: false,
      isZeroBalanceOrder: true,
      liveSavingsSelection: undefined,
      liveWalletSelection: { use: true, amount: 20_000 },
      mobileCheckoutIdempotencyRef: { current: null },
      onOrderCreated,
      paymentMethodForOrder: 'card',
      paymentSettings: {
        klump_enabled: true,
        klump_max_amount: 500_000,
        klump_min_amount: 10_000,
      },
      selectedPayment: 'klump',
      selectedQuote: undefined,
      setIsProcessing: jest.fn(),
      snapshot,
      walletSelection: { use: true, amount: 20_000 },
    });

    expect(submitBnplCheckout).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onOrderCreated).toHaveBeenCalledWith('order-off-1');
    expect(result).toEqual({
      creditFields: { wallet_amount_used: 20_000 },
      orderResponse,
    });
  });

  it('returns fallback zero-due BNPL order response when submitBnplCheckout stops at zero remaining balance', async () => {
    const fallbackOrderResponse: CreateOrderResult = {
      amountDueToGateway: 0,
      effectiveCheckoutGeneration: 'gen-off-2',
      order: {
        created_at: '2026-11-25T12:00:00.000Z',
        id: 'order-off-2',
        order_number: 'ORD-OFF-2',
        payment_status: 'paid',
        shipping_status: 'pending',
        total: 20_000,
      },
      wallet: { amountUsed: 20_000, newBalance: 0, transactionId: 'tx-off-2' },
    };
    const mockBnpl = submitBnplCheckout as jest.MockedFunction<
      typeof submitBnplCheckout
    >;
    mockBnpl.mockResolvedValue({
      creditFields: { wallet_amount_used: 20_000 },
      fallbackOrderResponse,
    });

    const result = await createOrSubmitCheckoutOrder({
      address,
      boundItemsSnapshot: [],
      checkoutGeneration: 'gen-off-2',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      getShippingProvider: () => undefined,
      isAuthenticated: true,
      isBNPL: true,
      isOrderInFlight: { current: true },
      isVoucherOnlyCart: false,
      isZeroBalanceOrder: false,
      liveSavingsSelection: undefined,
      liveWalletSelection: { use: true, amount: 10_000 },
      mobileCheckoutIdempotencyRef: { current: null },
      onOrderCreated: jest.fn(),
      paymentMethodForOrder: 'klump',
      paymentSettings: {
        klump_enabled: true,
        klump_max_amount: 500_000,
        klump_min_amount: 10_000,
      },
      selectedPayment: 'klump',
      selectedQuote: undefined,
      setIsProcessing: jest.fn(),
      snapshot,
      walletSelection: { use: true, amount: 10_000 },
    });

    expect(createSubmittedCheckoutOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      creditFields: { wallet_amount_used: 20_000 },
      orderResponse: fallbackOrderResponse,
    });
  });

  it('propagates rejection when submitBnplCheckout rejects an unpaid zero-due response', async () => {
    const mockBnpl = submitBnplCheckout as jest.MockedFunction<
      typeof submitBnplCheckout
    >;
    mockBnpl.mockRejectedValueOnce(
      new Error(
        'Your store credit could not complete this order. Please try again.'
      )
    );

    await expect(
      createOrSubmitCheckoutOrder({
        address,
        boundItemsSnapshot: [],
        checkoutGeneration: 'gen-off-3',
        customerEmail: 'ada@example.com',
        customerName: 'Ada Lovelace',
        customerPhone: '08012345678',
        deliveryMethod: 'door',
        getShippingProvider: () => undefined,
        isAuthenticated: true,
        isBNPL: true,
        isOrderInFlight: { current: true },
        isVoucherOnlyCart: false,
        isZeroBalanceOrder: false,
        liveSavingsSelection: undefined,
        liveWalletSelection: { use: true, amount: 10_000 },
        mobileCheckoutIdempotencyRef: { current: null },
        onOrderCreated: jest.fn(),
        paymentMethodForOrder: 'klump',
        paymentSettings: {
          klump_enabled: true,
          klump_max_amount: 500_000,
          klump_min_amount: 10_000,
        },
        selectedPayment: 'klump',
        selectedQuote: undefined,
        setIsProcessing: jest.fn(),
        snapshot,
        walletSelection: { use: true, amount: 10_000 },
      })
    ).rejects.toThrow(
      'Your store credit could not complete this order. Please try again.'
    );
    expect(createSubmittedCheckoutOrder).not.toHaveBeenCalled();
  });
});
