import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-client';
import { toast } from '@/hooks/use-toast';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import { createContext, readySharedCartCheckout } from './checkout-order-submission.test-support';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/cart/shared-cart-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/cart/shared-cart-client')>();
  return { ...actual, prepareSharedCartCheckout: vi.fn() };
});
vi.mock('../handlers/submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../prepare-checkout-order-submission', () => ({
  prepareCheckoutOrderSubmission: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

const sharedCartRef = {
  cartId: '22222222-2222-4222-8222-222222222222',
  version: 3,
};
const review = {
  cartId: sharedCartRef.cartId,
  cartVersion: 3,
  checkoutSessionId: '55555555-5555-4555-8555-555555555555',
  currency: 'NGN',
  generation: 1,
  lines: [
    {
      assuranceRate: null,
      available: true,
      condition: null,
      effectiveUnitPriceMinor: 25_000,
      hasAssurance: false,
      id: 'line-1',
      lastUnitPriceMinor: 25_000,
      manageStock: true,
      negotiatedUnitPriceMinor: null,
      negotiationInvalidated: false,
      negotiationStatus: null,
      options: {},
      priceChanged: false,
      productId: '44444444-4444-4444-8444-444444444444',
      quantity: 1,
      stockQty: 5,
      unavailableReason: null,
      validatedUnitPriceMinor: 25_000,
      variantId: null,
      voucherAwardId: null,
      voucherToken: null,
    },
  ],
  merchantId: 'merchant-1',
  subtotalMinor: 25_000,
  unavailableCount: 0,
};

const expiryCases = [
  [
    'monotonic deadline alone',
    () => ({ sessionExpiresAtMonotonicMs: performance.now() - 1 }),
  ],
  ['epoch deadline alone', () => ({ sessionExpiresAtEpochMs: Date.now() - 1 })],
  [
    'non-finite monotonic deadline',
    () => ({ sessionExpiresAtMonotonicMs: Number.NaN }),
  ],
  [
    'non-finite epoch deadline',
    () => ({ sessionExpiresAtEpochMs: Number.POSITIVE_INFINITY }),
  ],
] as const;

describe('useCheckoutOrderSubmission session expiry', () => {
  it.each(expiryCases)(
    'stops a fresh order when the %s expires or is invalid',
    async (_label, makeOverrides) => {
    const context = createContext();
    context.cart.checkoutCart = [
      {
        cartItemId: 'line-1',
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Phone',
        price: 250,
        quantity: 1,
        serverLineId: 'line-1',
      } as never,
    ];
    context.cart.checkoutCartTotal = 250;
    context.cart.sharedCartRef = sharedCartRef;
    context.cart.sharedCartSyncStatus = 'synced';
    context.resumed.order = null;
    context.resumed.preferredGateway = null;
    vi.mocked(prepareCheckoutOrderSubmission).mockReturnValue({
      kind: 'ready',
      delivery: {
        address: {},
        finalAddress: '1 Main St',
        finalCity: 'Lagos',
        finalState: 'Lagos',
        merchantRateId: null,
        shippingProvider: null,
      },
      identity: {
        checkoutFingerprint: 'fp-1',
        items: [],
        normalizedPaymentMethod: 'paystack',
      },
    } as never);
    vi.mocked(prepareSharedCartCheckout).mockResolvedValue(
      readySharedCartCheckout(review, makeOverrides())
    );

    const { result } = renderHook(() => useCheckoutOrderSubmission(context));
    await act(async () => result.current.handlePlaceOrder());

    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checkout Unavailable' })
    );
    expect(context.processing.releaseSubmission).toHaveBeenCalledOnce();
    }
  );
});
