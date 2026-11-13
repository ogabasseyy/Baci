import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { runCheckoutFinalization } from './run-checkout-finalization';
import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: jest.fn(),
  markCheckoutPurchaseEmitted: jest.fn(),
  trackCreationPurchaseEmission: jest.fn(),
}));

jest.mock('@/lib/claim-checkout-purchase-release', () => ({
  releaseCheckoutPurchaseTracking: jest.fn(),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePurchaseCompleted: jest.fn(),
}));

jest.mock('./run-finalize-checkout-payment', () => ({
  runFinalizeCheckoutPayment: jest.fn(),
}));

jest.mock('./checkout-post-order-side-effects', () => ({
  runCheckoutPostOrderSideEffects: jest.fn(),
}));

const mockClaim = jest.mocked(claimCheckoutPurchaseTracking);

function baseParams(emission: Promise<unknown>) {
  const { trackCheckoutRoutePurchaseCompleted } = jest.requireMock(
    '@/services/tiktok-checkout-route-tracking'
  ) as {
    trackCheckoutRoutePurchaseCompleted: jest.Mock;
  };
  trackCheckoutRoutePurchaseCompleted.mockReturnValue(emission);
  jest.mocked(runFinalizeCheckoutPayment).mockResolvedValue(undefined);
  return {
    accountPassword: undefined,
    address: {},
    clearCart: jest.fn(),
    completedPaymentMethod: 'card',
    customer: null,
    customerEmail: 'ada@example.com',
    customerName: 'Ada',
    customerPhone: '08012345678',
    isAuthenticated: false,
    isOrderInFlight: { current: false },
    itemsSnapshot: [],
    order: { id: 'order-1', total: 5000 },
    orderNumber: 'BAC-001',
    orderResponse: { order: { id: 'order-1', total: 5000 } },
    saveAsDefaultAddress: false,
    saveDetails: false,
    selectedPayment: 'card',
    selectedSavedAddressId: null,
    setIsProcessing: jest.fn(),
    setPendingOrder: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    snapshot: { deliveryFee: 0, subtotal: 5000, taxAmount: 0 },
    user: null,
    walletFundedBankTransferOptionEnabled: false,
  } as unknown as Parameters<typeof runCheckoutFinalization>[0];
}

describe('bugfix: wallet-funded transfer kept after the wallet turned PiggyVest mid-submit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaim.mockResolvedValue(true);
  });

  function transferParams(held: boolean) {
    return {
      ...baseParams(Promise.resolve(undefined)),
      isWalletFundedBankTransferHeld: () => held,
      selectedPayment: 'bank_transfer',
      walletFundedBankTransferOptionEnabled: true,
    } as unknown as Parameters<typeof runCheckoutFinalization>[0];
  }

  it('uses the standard per-order transfer when the live re-check holds it', async () => {
    // Arrange: the option was on at render, but a refresh landed as PiggyVest.
    const params = transferParams(true);

    // Act
    await runCheckoutFinalization(params);

    // Assert
    expect(runFinalizeCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldCreateWalletFundedBankTransferOrder: false,
        // The bank-transfer page tells the customer about the switch.
        walletTransferFallback: 'unconfirmed',
      })
    );
  });

  it('keeps the wallet-funded transfer when the live re-check still allows it', async () => {
    await runCheckoutFinalization(transferParams(false));

    expect(runFinalizeCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldCreateWalletFundedBankTransferOrder: true,
        walletTransferFallback: undefined,
      })
    );
  });
});
