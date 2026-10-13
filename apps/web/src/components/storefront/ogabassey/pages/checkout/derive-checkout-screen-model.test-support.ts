import { vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import type { CheckoutScreenModelInput } from './derive-checkout-screen-model';
import type { ResumedOrder } from './types';

export const setField = vi.fn();
export const setNewsletterOptIn = vi.fn();
export const setPayWithWallet = vi.fn();
export const handlePlaceOrder = vi.fn();
export const onReturnToCart = vi.fn();
export const onConfirmTransfer = vi.fn();
export const merchant = Object.freeze({
  id: 'merchant-1',
  user_id: 'user-1',
  country: 'NG',
  payout_currency: 'NGN',
  business_name: 'Baci Store',
  business_type: 'retail',
});
export const paymentSession: CheckoutScreenModelInput['sessions']['financial']['paymentSession'] =
  Object.freeze({
    tab: 'full',
    setTab: vi.fn(),
    method: 'paystack',
    selectMethod: vi.fn(),
    total: 107_500,
    wallet: Object.freeze({
      amountUsed: 0,
      balance: 2_500,
      setBalance: vi.fn(),
      currencySupported: true,
      loading: false,
      payWithWallet: false,
      redemptionAllowed: true,
      remainingAmount: 107_500,
      setPayWithWallet,
    }),
    checkoutValues: Object.freeze({
      payWithWallet: false,
      discountAmount: 0,
      discountCode: null,
      total: 107_500,
      useWalletCredit: false,
      walletAmountUsed: 0,
    }),
    payForMe: Object.freeze({
      isValid: true,
      details: Object.freeze({ name: '', contact: '', note: '' }),
      setDetails: vi.fn(),
    }),
    redvault: Object.freeze({
      orderReady: null,
      summary: null,
      setSummary: vi.fn(),
      status: 'idle',
      setStatus: vi.fn(),
      setOrderReady: vi.fn(),
    }),
    discount: Object.freeze({
      applied: null,
      setApplied: vi.fn(),
      amount: 0,
      code: null,
    }),
  });

export function makeInput(
  options: { resumedOrder?: ResumedOrder; hasCheckoutCartItems?: boolean } = {}
): CheckoutScreenModelInput {
  const resumedSubtotal = options.resumedOrder?.subtotal ?? 100_000;
  const resumedTotal = options.resumedOrder?.total ?? 107_500;
  const resumedTax = options.resumedOrder?.tax_amount ?? 7_500;
  const checkoutCart: CartItem[] = [
    {
      brand: 'Baci',
      cartItemId: 'cart-product-1',
      description: 'Test phone',
      gtin: '',
      id: 'product-1',
      image: '/phone.png',
      imageHint: 'Phone',
      imageLarge: '/phone.png',
      manage_stock: false,
      mpn: '',
      name: 'Phone',
      price: 100_000,
      quantity: 1,
      status: 'active',
      stock: 10,
    },
  ];
  const formValues: CheckoutScreenModelInput['sessions']['form']['form']['values'] =
    {
      firstName: 'Ada',
      lastName: 'Okon',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348031234567',
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
      deliveryCoordinates: null,
      deliveryMethod: 'door',
      airportType: 'delivery',
      airportRequiresQuote: false,
      selectedQuoteId: 'quote-1',
      selectedProviderRateId: '',
      newAddressStreet: '12 Broad Street',
      newAddressCity: 'Lagos Island',
      newAddressState: 'Lagos',
      newsletterOptIn: false,
    };
  const display = {
    summaryOrder: options.resumedOrder ?? null,
    displayItems: checkoutCart.map((item) => ({
      kind: 'cart' as const,
      ...item,
    })),
    effectiveCheckoutCartTotal: options.resumedOrder?.total ?? 100_000,
    effectiveItemSubtotal: resumedSubtotal,
    summarySubtotal: resumedSubtotal,
    hasCheckoutCartItems: true,
    mobileSummaryCart: checkoutCart,
  };
  const amounts: CheckoutScreenModelInput['sessions']['financial']['summaryAmounts'] =
    {
      summaryOrder: options.resumedOrder ?? null,
      summaryTaxAmount: resumedTax,
      summaryDeliveryCost: options.resumedOrder?.shipping_cost ?? 0,
      summaryGiftWrappingCost: options.resumedOrder?.gift_wrapping_fee ?? 0,
      summaryDiscountAmount: options.resumedOrder?.discount_amount ?? 0,
      summaryDeliveryMethod: options.resumedOrder ? null : 'door',
      summaryOrderTotals: { total: resumedTotal, taxAmount: resumedTax },
      summaryTaxLabel: options.resumedOrder ? 'Tax' : 'VAT',
    };
  const deliverySession: CheckoutScreenModelInput['sessions']['delivery'] = {
    address: {
      addresses: [],
      setAddresses: vi.fn(),
      selectedId: 0,
      setSelectedId: vi.fn(),
      isNewMode: true,
      setIsNewMode: vi.fn(),
      shippingStates: [],
      isLoadingLocations: false,
      isNewDeliveryAddressReady: true,
      handlers: {
        onSelectAddress: vi.fn(),
        onSelectPlace: vi.fn(),
        onStreetChange: vi.fn(),
      },
    },
    method: {
      selected: 'door',
      set: vi.fn(),
      eligible: 'door',
      airportType: 'delivery',
      setAirportType: vi.fn(),
      airportRequiresQuote: false,
      setAirportRequiresQuote: vi.fn(),
      select: vi.fn(),
    },
    quotes: {
      items: [],
      loading: false,
      selectedId: 'quote-1',
      setSelectedId: vi.fn(),
      selected: undefined,
      matchesSelectedMethod: true,
      hasMerchantPickup: false,
      stationPickup: undefined,
      stationPickupOptions: [],
      doorOptions: [],
      airOptions: [],
      resetForAddressChange: vi.fn(),
      fetch: vi.fn(),
    },
    options: null,
    validation: { isValid: true },
    cost: 0,
  };
  const defaults = {
    sessions: {
      form: {
        form: {
          values: formValues,
          contactValues: {
            firstName: 'Ada',
            lastName: 'Okon',
            customerEmail: 'ada@example.test',
            customerPhone: '+2348031234567',
          },
          setField,
          setFields: vi.fn(),
          setNewsletterOptIn,
          clear: vi.fn(),
          inferredLocation: {
            clearInferredLocationDebounce: vi.fn(),
            scheduleInferredLocationUpdate: vi.fn(),
          },
        },
        flow: {
          currentStep: 'payment' as const,
          completedSteps: { contact: true, delivery: true, payment: false },
          focusOnActivate: false,
          signedIn: true,
          setCurrentStep: vi.fn(),
          setCompletedSteps: vi.fn(),
          completeContact: vi.fn(),
        },
        account: {
          createAccount: false,
          password: '',
          setCreateAccount: vi.fn(),
          setPassword: vi.fn(),
        },
        auth: {
          isOpen: false,
          open: vi.fn(),
          close: vi.fn(),
          onOpenChange: vi.fn(),
        },
      },
      attempt: {
        resumeOrderId: options.resumedOrder?.id ?? null,
        resumedOrder: options.resumedOrder ?? null,
        isProcessing: false,
      },
      delivery: deliverySession,
      financial: {
        paymentSession,
        summaryAmounts: amounts,
      },
      execution: {
        crypto: {
          cryptoPaymentData: null,
          setCryptoPaymentData: vi.fn(),
          isVerifyingCrypto: false,
          cryptoVerificationStatus: 'idle' as const,
          isInitializingCrypto: false,
          initializeCryptoPayment: vi.fn(),
          verifyCryptoPayment: vi.fn(),
          dismissCryptoModal: vi.fn(),
          cancelCryptoInitialization: vi.fn(),
          pendingCryptoOrder: null,
          setPendingCryptoOrder: vi.fn(),
          showCryptoSelector: false,
          setShowCryptoSelector: vi.fn(),
          selectedCryptoChain: 'TRX',
          selectedCryptoCurrency: 'USDT',
          supportedChains: ['TRX', 'ETH'],
          changeCurrency: vi.fn(),
          changeChain: vi.fn(),
          closeSelector: vi.fn(),
        } satisfies CheckoutScreenModelInput['sessions']['execution']['crypto'],
        dva: {
          dvaData: null,
          isVerifyingDva: false,
          isInitializingDva: false,
          closeDvaModal: vi.fn(),
          handleDvaConfirmTransfer: onConfirmTransfer,
          setDvaData: vi.fn(),
          setIsInitializingDva: vi.fn(),
        },
        handlePlaceOrder,
        walletFundedTransfer: {
          start: vi.fn(),
          account: null,
          intent: null,
          acceptConsent: vi.fn(),
          checkNow: vi.fn(),
          close: vi.fn(),
          consentRequested: false,
          declineConsent: vi.fn(),
          error: null,
          isChecking: false,
        } satisfies CheckoutScreenModelInput['sessions']['execution']['walletFundedTransfer'],
      },
    },
    display: {
      checkoutDisplay: {
        ...display,
        hasCheckoutCartItems: options.hasCheckoutCartItems ?? true,
      },
      checkoutCart,
      isHydrated: true,
    },
    identity: {
      merchant,
      user: { id: 'customer-1' },
      currencyCode: 'NGN',
      currencySymbol: '₦',
      merchantCountry: 'NG',
      formatCurrencyAuto: (amount: number) => `₦${amount}`,
    },
    actions: { onReturnToCart },
    availability: { redvaultAvailable: false },
  };
  return defaults satisfies CheckoutScreenModelInput;
}
