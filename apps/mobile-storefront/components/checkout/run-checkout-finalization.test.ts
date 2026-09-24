import { describe, expect, it, jest } from '@jest/globals';
import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  markCheckoutPurchaseEmitted,
  trackCreationPurchaseEmission,
} from '@/lib/claim-checkout-purchase-tracking';
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
const mockMarkEmitted = jest.mocked(markCheckoutPurchaseEmitted);
const mockRelease = jest.mocked(releaseCheckoutPurchaseTracking);

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

describe('runCheckoutFinalization purchase emission proof', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stamps the purchase claim after a successful creation emission', async () => {
    mockClaim.mockResolvedValue(true);
    let resolveEmission!: (value: unknown) => void;
    const emission = new Promise((resolve) => {
      resolveEmission = resolve;
    });

    const run = runCheckoutFinalization(baseParams(emission));
    resolveEmission(undefined);
    await run;
    // The stamp rides the fire-and-forget emission continuation.
    await emission.then(
      () => undefined,
      () => undefined
    );
    await Promise.resolve();

    expect(mockMarkEmitted).toHaveBeenCalledWith('order-1');
    expect(trackCreationPurchaseEmission).toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('releases the claim when the creation emission rejects', async () => {
    mockClaim.mockResolvedValue(true);
    let rejectEmission!: (reason?: unknown) => void;
    const emission = new Promise((_, reject) => {
      rejectEmission = reject;
    });
    // Avoid an unhandled rejection: the unit under test attaches its
    // own continuation, but attach a quiet observer first.
    emission.catch(() => undefined);

    const run = runCheckoutFinalization(baseParams(emission));
    rejectEmission(new Error('network down'));
    await run;
    await emission.then(
      () => undefined,
      () => undefined
    );
    await Promise.resolve();

    expect(mockRelease).toHaveBeenCalledWith('order-1');
    expect(mockMarkEmitted).not.toHaveBeenCalled();
  });
});
