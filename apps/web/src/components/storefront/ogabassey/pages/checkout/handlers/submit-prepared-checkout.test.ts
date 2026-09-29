import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import { submitFreshCheckout } from './submit-fresh-checkout';
import { submitPreparedCheckout } from './submit-prepared-checkout';
import type { CheckoutOrderSubmissionContext } from '../hooks/checkout-order-submission-types';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import { readCheckoutAttemptGeneration } from '../checkout-attempt-generation';
import type { CheckoutOrderLifecycleResult } from './checkout-order-lifecycle';

vi.mock('./submit-fresh-checkout', () => ({
  submitFreshCheckout: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

function createContext({
  method = 'paystack',
  password = '123456',
}: {
  method?: 'paystack' | 'uba_redvault';
  password?: string;
} = {}): CheckoutOrderSubmissionContext & { merchant: MerchantData } {
  const paymentSession = {
    method,
    total: 12_500,
    checkoutValues: {
      discountAmount: 1_200,
      discountCode: 'SAVE',
      useWalletCredit: true,
    },
    wallet: { amountUsed: 600, setBalance: vi.fn() },
    redvault: {
      orderReady: null,
      setStatus: vi.fn(),
      setOrderReady: vi.fn(),
      setSummary: vi.fn(),
    },
    payForMe: { details: { name: '', contact: '', note: '' } },
  } as unknown as CheckoutOrderSubmissionContext['payment']['session'];
  const context = {
    account: {
      createAccount: true,
      password,
      user: null,
      waitForResolvedCustomerAuth: vi.fn().mockResolvedValue(true),
    },
    cart: {
      cart: [],
      checkoutCart: [],
      checkoutCartTotal: 11_000,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
    },
    contact: {
      customerEmail: 'buyer@example.com',
      customerPhone: '+2348000000000',
      firstName: 'Ada',
      lastName: 'Okon',
      newsletterOptIn: false,
    },
    delivery: {
      session: {
        cost: 2_500,
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
      giftWrappingCost: 400,
      effectiveItemSubtotal: 9_500,
      taxAmount: 600,
    },
    merchant: { id: 'merchant-1', slug: 'ada-store' } as MerchantData,
    navigation: {
      setCurrentStep: vi.fn(),
      setCompletedSteps: vi.fn(),
      pushSuccessRoute: vi.fn(),
      getHref: (path: string) => `/ada-store${path}`,
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
      session: paymentSession,
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: true,
      redvaultAvailable: true,
      currencyCode: 'NGN',
    },
    resumed: {
      order: null,
      preferredGateway: null,
      trackingToken: null,
      merchantSlugFromResume: null,
    },
    processing: {
      setIsProcessing: vi.fn(),
      isOrderInFlightRef: { current: true },
      tryBeginSubmission: vi.fn(() => true),
      releaseSubmission: vi.fn(),
      handleSubmissionError: vi.fn(),
    },
  };
  return context as CheckoutOrderSubmissionContext & { merchant: MerchantData };
}

function prepareReadySubmission(method: 'paystack' | 'uba_redvault') {
  const prepared = prepareCheckoutOrderSubmission({
    payment: {
      method,
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: true,
      redvaultAvailable: true,
      remainingAmount: 10_300,
      total: 12_500,
    },
    delivery: {
      method: 'pickup',
      selectedQuoteId: '',
      selectedQuoteMatchesMethod: false,
      airportRequiresQuote: false,
      airportType: 'delivery',
      quotes: [],
      addresses: [],
      selectedAddressId: null,
      isNewAddressMode: true,
      newAddressStreet: '',
      newAddressCity: '',
      newAddressState: '',
      customerPhone: '+2348000000000',
      merchantCountry: 'NG',
      deliveryCost: 2_500,
    },
    identity: {
      merchantId: 'merchant-1',
      customerEmail: 'buyer@example.com',
      customerName: 'Ada Okon',
      customerPhone: '+2348000000000',
      checkoutItems: [],
      useWalletCredit: true,
      walletAmountUsed: 600,
      discountCode: 'SAVE',
      giftWrappingCost: 400,
    },
  });
  if (prepared.kind !== 'ready') throw new Error('Expected ready submission');
  return prepared;
}

const paymentReady: Extract<CheckoutOrderLifecycleResult, { kind: 'payment_ready' }> = {
  kind: 'payment_ready',
  order: { id: 'order-1', total: 12_500 },
  wallet: null,
  amountDueToGateway: 10_300,
  createdOrderNumber: 'ORD-1',
  orderChargeCurrency: 'NGN',
  billingAddress: {
    line1: 'Pickup at Store',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
    zip_code: '100001',
  },
};

describe('submitPreparedCheckout', () => {
  it('preserves authoritative totals and binds lifecycle callbacks to checkout actions', async () => {
    const context = createContext();
    const prepared = prepareReadySubmission('paystack');
    await submitPreparedCheckout(context, prepared);
    const options = vi.mocked(submitFreshCheckout).mock.calls[0]?.[0];
    expect(options).toBeDefined();
    if (!options) return;

    expect(options.lifecycle.state).toMatchObject({
      total: 12_500,
      orderRequestSubtotal: 11_000,
      subtotal: 9_500,
      shipping: 2_500,
      tax: 600,
      giftWrappingCost: 400,
      discountAmount: 1_200,
      walletAmountUsed: 600,
    });
    expect(options.lifecycle.redvault.enabled).toBe(false);

    const generation = readCheckoutAttemptGeneration();
    options.lifecycle.actions.onOrderCreated({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      currency: 'NGN',
    });
    expect(context.order.setOrderCreated).toHaveBeenCalledWith(true);
    expect(readCheckoutAttemptGeneration()).toBe(generation + 1);
    options.lifecycle.actions.pushSuccessRoute('/checkout/success');
    expect(context.navigation.pushSuccessRoute).toHaveBeenCalledWith(
      '/ada-store/checkout/success'
    );

    const paymentOptions = options.createPaymentOptions(paymentReady);
    expect(paymentOptions.signupBeforePayment).toBeDefined();
  });

  it.each([
    { password: '12345', shouldSignupBeforePayment: false },
    { password: '123456', shouldSignupBeforePayment: true },
  ])('requires the existing account password threshold ($password)', async ({ password, shouldSignupBeforePayment }) => {
    const context = createContext({ password });
    await submitPreparedCheckout(context, prepareReadySubmission('paystack'));
    const options = vi.mocked(submitFreshCheckout).mock.calls[0]?.[0];
    expect(options).toBeDefined();
    if (!options) return;

    expect(options.createPaymentOptions(paymentReady).signupBeforePayment !== undefined)
      .toBe(shouldSignupBeforePayment);
  });

  it('does not attempt pre-payment signup on Redvault', async () => {
    const context = createContext({ method: 'uba_redvault' });
    await submitPreparedCheckout(context, prepareReadySubmission('uba_redvault'));
    const options = vi.mocked(submitFreshCheckout).mock.calls[0]?.[0];
    expect(options).toBeDefined();
    if (!options) return;

    expect(options.lifecycle.redvault.enabled).toBe(true);
    expect(options.createPaymentOptions(paymentReady).signupBeforePayment).toBeUndefined();
  });
});
