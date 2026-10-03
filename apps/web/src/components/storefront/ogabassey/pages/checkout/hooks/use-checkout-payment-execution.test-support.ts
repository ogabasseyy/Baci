import { vi } from 'vitest';
import type { CheckoutPaymentExecutionOptions } from './use-checkout-payment-execution';

export const dva = {
  closeDvaModal: vi.fn(),
  dvaData: null,
  handleDvaConfirmTransfer: vi.fn(),
  isInitializingDva: false,
  isVerifyingDva: false,
  setDvaData: vi.fn(),
  setIsInitializingDva: vi.fn(),
};
export const crypto = {
  setPendingCryptoOrder: vi.fn(),
  setShowCryptoSelector: vi.fn(),
  setCryptoPaymentData: vi.fn(),
};
export const walletTransfer = { start: vi.fn(), account: null, intent: null };
export const handlePlaceOrder = vi.fn();
export const waitForResolvedCustomerAuth = vi.fn(async () => true);

export function createOptions(
  resumed: Pick<
    CheckoutPaymentExecutionOptions['attempt'],
    | 'resumedOrder'
    | 'preferredGateway'
    | 'resumeTrackingToken'
    | 'resumeMerchantSlug'
  > = {
    resumedOrder: null,
    preferredGateway: null,
    resumeTrackingToken: null,
    resumeMerchantSlug: null,
  },
  identity: CheckoutPaymentExecutionOptions['identity'] = {
    merchantId: 'merchant-1',
    merchantSlug: 'test-store',
    currencyCode: 'NGN',
  }
): CheckoutPaymentExecutionOptions {
  return {
    identity,
    form: {
      session: {
        values: {
          customerEmail: 'ada@example.test',
          customerPhone: '+2348031234567',
          firstName: 'Ada',
          lastName: 'Okafor',
          newsletterOptIn: false,
          deliveryMethod: 'door',
          airportType: 'delivery',
          airportRequiresQuote: false,
          newAddressStreet: '1 Main St',
          newAddressCity: 'Lagos',
          newAddressState: 'Lagos',
        } as CheckoutPaymentExecutionOptions['form']['session']['values'],
        clear: vi.fn(),
      } as unknown as CheckoutPaymentExecutionOptions['form']['session'],
      account: {
        createAccount: false,
        password: '',
        setCreateAccount: vi.fn(),
        setPassword: vi.fn(),
      },
      user: null,
    },
    cart: {
      cart: [],
      checkoutCart: [],
      checkoutCartTotal: 5000,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
    },
    delivery: {} as unknown as CheckoutPaymentExecutionOptions['delivery'],
    merchant: null,
    navigation: {
      flow: {
        setCurrentStep: vi.fn(),
        setCompletedSteps: vi.fn(),
      },
      pushSuccessRoute: vi.fn(),
      getHref: (path) => `/shop${path}`,
    },
    payment: {
      session: {
        method: 'bank_transfer',
      } as unknown as CheckoutPaymentExecutionOptions['payment']['session'],
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: false,
      redvaultAvailable: false,
      currencyCode: 'NGN',
    },
    attempt: {
      ...resumed,
      pendingCheckoutOrder: null,
      clearPendingCheckoutOrder: vi.fn(),
      setPendingCheckoutOrder: vi.fn(),
      setCheckoutOrderCreated: vi.fn(),
      setIsProcessing: vi.fn(),
      isOrderInFlightRef: { current: false },
      tryBeginSubmission: vi.fn(() => true),
      releaseSubmission: vi.fn(),
      handleSubmissionError: vi.fn(),
    },
  };
}
