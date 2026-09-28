import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import type { PrepareCheckoutOrderSubmissionResult } from '../prepare-checkout-order-submission';
import type { ResumedOrder } from '../types';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
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
      setDvaCountdown: vi.fn(),
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
});
