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
} from './checkout-payment-finalization.test-utils';

let finalizeCheckoutPayment: typeof import('./checkout-payment-finalization')['finalizeCheckoutPayment'];

function finalizeWithRedvault(
  orderResponse: ReturnType<typeof createOrderResponse>,
  runPostOrderSideEffects: () => void
) {
  return finalizeCheckoutPayment({
    clearCart: jest.fn<() => void | Promise<void>>(),
    customerEmail: 'ada@example.com',
    customerName: 'Ada Winner',
    customerPhone: '08012345678',
    isOrderInFlight: { current: true },
    orderNumber: 'BAC-001',
    orderResponse,
    runPostOrderSideEffects,
    selectedPayment: 'uba_redvault',
    setIsProcessing: jest.fn(),
    setPendingOrder: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    shouldCreateWalletFundedBankTransferOrder: false,
  });
}

describe('finalizeCheckoutPayment with REDVAULT selected', () => {
  beforeAll(async () => {
    ({ finalizeCheckoutPayment } = await import(
      './checkout-payment-finalization'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClearAndPersistCheckoutCart.mockImplementation(async (clearCart) => {
      await clearCart();
    });
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('bugfix: a settled quiz prize reaches success instead of a review error', async () => {
    const runPostOrderSideEffects = jest.fn();

    await finalizeWithRedvault(
      createOrderResponse({
        amountDueToGateway: 0,
        order: { payment_status: 'paid', total: 3500 },
      }),
      runPostOrderSideEffects
    );

    const navigations = [
      ...mockRouterPush.mock.calls,
      ...mockRouterReplace.mock.calls,
    ];
    expect(navigations).toHaveLength(1);
    expect(navigations[0]?.[0]).toEqual(
      expect.objectContaining({ pathname: '/order-success' })
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(runPostOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('still requires the REDVAULT review while money is due', async () => {
    const runPostOrderSideEffects = jest.fn();

    await expect(
      finalizeWithRedvault(createOrderResponse(), runPostOrderSideEffects)
    ).rejects.toMatchObject({ code: 'REDVAULT_REVIEW_REQUIRED' });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(runPostOrderSideEffects).not.toHaveBeenCalled();
  });

  it('still requires the review for a paid order that owes a balance', async () => {
    await expect(
      finalizeWithRedvault(
        createOrderResponse({
          amountDueToGateway: 3500,
          order: { payment_status: 'paid' },
        }),
        jest.fn()
      )
    ).rejects.toMatchObject({ code: 'REDVAULT_REVIEW_REQUIRED' });
  });
});
