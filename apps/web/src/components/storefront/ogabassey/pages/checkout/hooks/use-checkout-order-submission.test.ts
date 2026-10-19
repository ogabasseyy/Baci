import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-client';
import { toast } from '@/hooks/use-toast';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import type { PrepareCheckoutOrderSubmissionResult } from '../prepare-checkout-order-submission';
import type { ResumedOrder } from '../types';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/cart/shared-cart-client', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/hooks/cart/shared-cart-client')
    >();
  return { ...actual, prepareSharedCartCheckout: vi.fn() };
});
vi.mock('../handlers/direct-payment', () => ({
  executeResumedDirectPayment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../handlers/submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../prepare-checkout-order-submission', () => ({
  prepareCheckoutOrderSubmission: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

const resumedOrder: ResumedOrder = {
  id: 'order-1',
  short_id: 'short-1',
  subtotal: 1000,
  shipping_cost: 0,
  total: 1000,
  customer_name: 'Ada Okon',
  customer_email: 'ada@example.com',
  customer_phone: '+2348000000000',
  shipping_address: { address: '1 Main St', city: 'Lagos', state: 'Lagos', phone: '+2348000000000' },
  items: [],
};

function createContext(): CheckoutOrderSubmissionContext {
  const isOrderInFlightRef = { current: false };
  const releaseSubmission = vi.fn(() => {
    isOrderInFlightRef.current = false;
  });
  return {
    account: {
      createAccount: false,
      password: '',
      user: null,
      waitForResolvedCustomerAuth: vi.fn().mockResolvedValue(true),
    },
    cart: {
      cart: [],
      checkoutCart: [],
      checkoutCartTotal: 1000,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
    },
    contact: {
      customerEmail: 'ada@example.com',
      customerPhone: '+2348000000000',
      firstName: 'Ada',
      lastName: 'Okon',
      newsletterOptIn: false,
    },
    delivery: {
      session: {
        cost: 0,
        quotes: { selectedId: '', matchesSelectedMethod: false, items: [] },
        address: { addresses: [], selectedId: null, isNewMode: true },
      } as unknown as CheckoutOrderSubmissionContext['delivery']['session'],
      method: 'pickup',
      airportType: 'delivery',
      airportRequiresQuote: false,
      newAddressStreet: '',
      newAddressCity: '',
      newAddressState: '',
      merchantCountry: 'NG',
      giftWrappingCost: 0,
      effectiveItemSubtotal: 1000,
      taxAmount: 0,
    },
    merchant: { id: 'merchant-1', slug: 'ada-store' } as CheckoutOrderSubmissionContext['merchant'],
    navigation: {
      setCurrentStep: vi.fn(),
      setCompletedSteps: vi.fn(),
      pushSuccessRoute: vi.fn(),
      getHref: (path) => path,
    },
    order: {
      pending: null,
      clearPending: vi.fn(),
      setPending: vi.fn(),
      setOrderCreated: vi.fn(),
      clearCheckoutSession: vi.fn(),
      setDvaData: vi.fn(),
      setIsInitializingDva: vi.fn(),
      setPendingCryptoOrder: vi.fn(),
      setShowCryptoSelector: vi.fn(),
      setCryptoPaymentData: vi.fn(),
      walletFundedTransfer: {} as CheckoutOrderSubmissionContext['order']['walletFundedTransfer'],
    },
    payment: {
      session: {
        method: 'paystack',
        total: 1000,
        wallet: { remainingAmount: 1000, amountUsed: 0, setBalance: vi.fn() },
        redvault: { status: 'idle' },
        checkoutValues: { useWalletCredit: false, discountCode: null, discountAmount: 0 },
      } as unknown as CheckoutOrderSubmissionContext['payment']['session'],
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: true,
      redvaultAvailable: true,
      currencyCode: 'NGN',
    },
    resumed: {
      order: resumedOrder,
      preferredGateway: 'credpal',
      trackingToken: 'tracking-token',
      merchantSlugFromResume: 'ada-store',
    },
    processing: {
      setIsProcessing: vi.fn(),
      isOrderInFlightRef,
      tryBeginSubmission: vi.fn((blocked: boolean) => {
        if (blocked || isOrderInFlightRef.current) return false;
        isOrderInFlightRef.current = true;
        return true;
      }),
      releaseSubmission,
      handleSubmissionError: vi.fn(),
    },
  };
}

describe('useCheckoutOrderSubmission', () => {
  it('continues a resumed order through its selected gateway without creating a fresh order', async () => {
    const context = createContext();
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(context.processing.tryBeginSubmission).toHaveBeenCalledWith(false);
    expect(executeResumedDirectPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        resumedOrder,
        preferredGateway: 'credpal',
        resumeTrackingToken: 'tracking-token',
        resumeMerchantSlug: 'ada-store',
      })
    );
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(context.processing.isOrderInFlightRef.current).toBe(false);
  });

  it('uses active-cart amounts when a resume link and preferred gateway coexist', async () => {
    const context = createContext();
    context.cart.checkoutCart = [
      {
        id: 'cart-item-1',
        cartItemId: 'cart-item-1',
        name: 'Active cart item',
        price: 10_000,
        quantity: 1,
      } as CheckoutOrderSubmissionContext['cart']['checkoutCart'][number],
    ];
    context.cart.checkoutCartTotal = 10_000;
    context.payment.session = {
      ...context.payment.session,
      method: 'credpal',
      total: 10_750,
      wallet: { ...context.payment.session.wallet, remainingAmount: 8_250, amountUsed: 2_500 },
      checkoutValues: { ...context.payment.session.checkoutValues, useWalletCredit: true },
    } as CheckoutOrderSubmissionContext['payment']['session'];
    vi.mocked(prepareCheckoutOrderSubmission).mockReturnValue({
      kind: 'issue',
      issue: 'delivery-option',
    });
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(executeResumedDirectPayment).not.toHaveBeenCalled();
    expect(prepareCheckoutOrderSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({
          method: 'credpal',
          total: 10_750,
          remainingAmount: 8_250,
        }),
        identity: expect.objectContaining({
          useWalletCredit: true,
          walletAmountUsed: 2_500,
        }),
      })
    );
  });

  it('keeps the in-flight fence held while a resumed gateway is still opening', async () => {
    const context = createContext();
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));
    let finishDirectPayment = () => {};
    vi.mocked(executeResumedDirectPayment).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishDirectPayment = resolve; })
    );

    const firstSubmit = result.current.handlePlaceOrder();
    expect(context.processing.isOrderInFlightRef.current).toBe(true);
    await act(async () => result.current.handlePlaceOrder());

    expect(executeResumedDirectPayment).toHaveBeenCalledTimes(1);
    expect(submitPreparedCheckout).not.toHaveBeenCalled();

    await act(async () => {
      finishDirectPayment();
      await firstSubmit;
    });
    expect(context.processing.isOrderInFlightRef.current).toBe(false);
  });

  it('releases the submit fence when required customer identity is missing', async () => {
    const context = createContext();
    context.contact.customerEmail = '';
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Missing Information' }));
    expect(context.processing.isOrderInFlightRef.current).toBe(false);
    expect(executeResumedDirectPayment).not.toHaveBeenCalled();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  it('hands a ready fresh-order snapshot to the order lifecycle', async () => {
    const context = createContext();
    context.resumed.order = null;
    context.resumed.preferredGateway = null;
    const prepared = {
      kind: 'ready',
      delivery: {
        address: {
          address: 'Pickup at Store',
          city: 'Lagos',
          state: 'Lagos',
          phone: '+2348000000000',
          countryCode: 'NG',
          country: 'Nigeria',
        },
        finalAddress: 'Pickup at Store',
        finalCity: 'Lagos',
        finalState: 'Lagos',
        merchantRateId: null,
        shippingProvider: null,
      },
      identity: {
        items: [],
        normalizedPaymentMethod: 'paystack',
        checkoutFingerprint: 'authoritative-checkout-fingerprint',
      },
    } satisfies PrepareCheckoutOrderSubmissionResult;
    vi.mocked(prepareCheckoutOrderSubmission).mockReturnValue(prepared);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(prepareCheckoutOrderSubmission).toHaveBeenCalledOnce();
    expect(submitPreparedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: context.merchant }),
      prepared
    );
  });

  it.each([
    { issue: 'delivery-option', step: 'delivery', releasesThroughHelper: false },
    { issue: 'bank-transfer-unavailable', releasesThroughHelper: false },
    { issue: 'paystack-unavailable', releasesThroughHelper: false },
    { issue: 'korapay-unavailable', releasesThroughHelper: false },
    { issue: 'redvault-unavailable', releasesThroughHelper: false },
    { issue: 'klump-unavailable', releasesThroughHelper: true },
    { issue: 'incomplete-address', step: 'delivery', releasesThroughHelper: false },
    { issue: 'delivery-required', releasesThroughHelper: true },
    { issue: 'shipping-expired', releasesThroughHelper: true },
  ] as const)('cleans up and applies recovery for $issue', async ({ issue, step, releasesThroughHelper }) => {
    const context = createContext();
    context.resumed.order = null;
    context.resumed.preferredGateway = null;
    vi.mocked(prepareCheckoutOrderSubmission).mockReturnValue({ kind: 'issue', issue });
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(toast).toHaveBeenCalled();
    expect(context.processing.isOrderInFlightRef.current).toBe(false);
    expect(context.processing.releaseSubmission).toHaveBeenCalledTimes(releasesThroughHelper ? 1 : 0);
    expect(context.navigation.setCurrentStep).toHaveBeenCalledTimes(step ? 1 : 0);
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    if (issue === 'incomplete-address') {
      expect(context.processing.setIsProcessing).toHaveBeenCalledWith(false);
    }
  });

  it('releases the fence when merchant context is unavailable', async () => {
    const context = createContext();
    context.merchant = null;
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    expect(context.processing.isOrderInFlightRef.current).toBe(false);
    expect(prepareCheckoutOrderSubmission).not.toHaveBeenCalled();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  describe('shared cart binding', () => {
    const SHARED_REF = {
      cartId: '22222222-2222-4222-8222-222222222222',
      version: 3,
    };
    const REVIEW = {
      cartId: SHARED_REF.cartId,
      cartVersion: 3,
      checkoutSessionId: '55555555-5555-4555-8555-555555555555',
      currency: 'NGN',
      generation: 1,
      lines: [
        {
          assuranceRate: null,
          available: true,
          condition: null,
          effectiveUnitPriceMinor: 25000,
          hasAssurance: false,
          id: 'line-1',
          lastUnitPriceMinor: 25000,
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
          validatedUnitPriceMinor: 25000,
          variantId: null,
          voucherAwardId: null,
          voucherToken: null,
        },
      ],
      merchantId: 'merchant-1',
      subtotalMinor: 25000,
      unavailableCount: 0,
    };

    function freshContext() {
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
      } as unknown as PrepareCheckoutOrderSubmissionResult);
      return context;
    }

    it('blocks enrolled cached carts until adoption provides an authoritative reference', async () => {
      const context = freshContext();
      context.cart.sharedCartEnabled = true;
      context.cart.sharedCartRef = null;
      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());
      expect(submitPreparedCheckout).not.toHaveBeenCalled();
    });

    it('prepares the shared cart and binds the submit', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        ok: true,
        replayed: false,
        review: REVIEW,
        sessionReused: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(prepareSharedCartCheckout).toHaveBeenCalledWith({
        cartId: SHARED_REF.cartId,
        expectedVersion: 3,
        operationId: expect.any(String),
      }, 'ada-store');
      expect(submitPreparedCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          identity: expect.objectContaining({
            sharedCartBinding: {
              cart_id: SHARED_REF.cartId,
              cart_version: 3,
              checkout_generation: 1,
              checkout_session_id: REVIEW.checkoutSessionId,
            },
          }),
        })
      );
    });

    it('binds insured shared carts whose display total includes the assurance fee', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      // The shopper-facing total includes the per-item assurance fee;
      // the reviewed subtotal never does. Comparing the two directly
      // would reject every insured cart as a phantom price change.
      context.cart.checkoutCart = [
        {
          cartItemId: 'line-1',
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Phone',
          price: 250,
          quantity: 1,
          serverLineId: 'line-1',
          hasAssurance: true,
          assuranceRate: 0.1,
        } as never,
      ];
      context.cart.checkoutCartTotal = 275;
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        ok: true,
        replayed: false,
        review: {
          ...REVIEW,
          lines: [
            { ...REVIEW.lines[0], assuranceRate: 0.1, hasAssurance: true },
          ],
        },
        sessionReused: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(submitPreparedCheckout).toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Prices Updated' })
      );
    });

    it('stops the submit when the review reports unavailable lines', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      context.cart.refreshSharedCart = vi.fn().mockResolvedValue(undefined);
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        ok: true,
        replayed: false,
        review: {
          ...REVIEW,
          lines: [{ ...REVIEW.lines[0], available: false }],
          unavailableCount: 1,
        },
        sessionReused: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(context.cart.refreshSharedCart).toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Update Your Cart' })
      );
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });

    it('stops the submit when the reviewed subtotal moved', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      context.cart.refreshSharedCart = vi.fn().mockResolvedValue(undefined);
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        ok: true,
        replayed: false,
        review: { ...REVIEW, subtotalMinor: 24000 },
        sessionReused: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Prices Updated' })
      );
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });

    it.each(['pending', 'retrying'] as const)(
      'waits for sync instead of submitting while %s',
      async (syncStatus) => {
        const context = freshContext();
        context.cart.sharedCartRef = SHARED_REF;
        context.cart.sharedCartSyncStatus = syncStatus;

        const { result } = renderHook(() =>
          useCheckoutOrderSubmission(context)
        );
        await act(async () => result.current.handlePlaceOrder());

        expect(prepareSharedCartCheckout).not.toHaveBeenCalled();
        expect(submitPreparedCheckout).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Cart Syncing' })
        );
        expect(context.processing.isOrderInFlightRef.current).toBe(false);
      }
    );

    it('stops the submit when the shared cart failed to sync', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'error';

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(prepareSharedCartCheckout).not.toHaveBeenCalled();
      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Cart Sync Failed' })
      );
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });

    it('skips preparation for legacy carts', async () => {
      const context = freshContext();

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(prepareSharedCartCheckout).not.toHaveBeenCalled();
      expect(submitPreparedCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          identity: expect.not.objectContaining({
            sharedCartBinding: expect.anything(),
          }),
        })
      );
    });

    it('refreshes the cart and stops the submit when the review goes stale', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      const refreshSharedCart = vi.fn().mockResolvedValue(undefined);
      context.cart.refreshSharedCart = refreshSharedCart;
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        code: 'refresh_required',
        currentVersion: 4,
        ok: false,
        retryable: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(refreshSharedCart).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Cart Changed' })
      );
      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });

    it('stops the submit when preparation fails', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        code: 'temporarily_unavailable',
        currentVersion: null,
        ok: false,
        retryable: true,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Checkout Unavailable' })
      );
      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });

    it('stops the submit when the display cart includes an unimported zero-price line not in the review', async () => {
      const context = freshContext();
      context.cart.sharedCartRef = SHARED_REF;
      context.cart.sharedCartSyncStatus = 'synced';
      context.cart.refreshSharedCart = vi.fn().mockResolvedValue(undefined);
      context.cart.checkoutCart = [
        ...context.cart.checkoutCart,
        {
          cartItemId: 'unimported-prize',
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Unimported Voucher Prize',
          price: 0,
          quantity: 1,
        } as never,
      ];
      vi.mocked(prepareSharedCartCheckout).mockResolvedValue({
        ok: true,
        replayed: false,
        review: REVIEW,
        sessionReused: false,
      });

      const { result } = renderHook(() => useCheckoutOrderSubmission(context));
      await act(async () => result.current.handlePlaceOrder());

      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(context.cart.refreshSharedCart).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Cart Changed' })
      );
      expect(context.processing.isOrderInFlightRef.current).toBe(false);
    });
  });
});
