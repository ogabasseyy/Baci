import { vi } from 'vitest';
import type { ResumedOrder } from '../types';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

export const resumedOrder: ResumedOrder = {
  id: 'order-1',
  short_id: 'short-1',
  subtotal: 1000,
  shipping_cost: 0,
  total: 1000,
  customer_name: 'Ada Okon',
  customer_email: 'ada@example.com',
  customer_phone: '+2348000000000',
  shipping_address: {
    address: '1 Main St',
    city: 'Lagos',
    state: 'Lagos',
    phone: '+2348000000000',
  },
  items: [],
};

export function createContext(): CheckoutOrderSubmissionContext {
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
        validation: { isValid: true },
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
    merchant: {
      id: 'merchant-1',
      slug: 'ada-store',
    } as CheckoutOrderSubmissionContext['merchant'],
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
      walletFundedTransfer:
        {} as CheckoutOrderSubmissionContext['order']['walletFundedTransfer'],
    },
    payment: {
      session: {
        method: 'paystack',
        total: 1000,
        wallet: { remainingAmount: 1000, amountUsed: 0, setBalance: vi.fn() },
        redvault: { status: 'idle' },
        checkoutValues: {
          useWalletCredit: false,
          discountCode: null,
          discountAmount: 0,
        },
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
