import { describe, expect, it, vi } from 'vitest';
import type { CheckoutScreenModelInput } from './derive-checkout-screen-model';
import { deriveCheckoutScreenModel } from './derive-checkout-screen-model';

const setField = vi.fn();
const setNewsletterOptIn = vi.fn();
const setPayWithWallet = vi.fn();
const handlePlaceOrder = vi.fn();
const onReturnToCart = vi.fn();
const onConfirmTransfer = vi.fn();
const merchant = {
  id: 'merchant-1',
  country: 'NG',
  payout_currency: 'NGN',
  business_name: 'Baci Store',
};
const paymentSession = {
  method: 'paystack',
  total: 107_500,
  wallet: {
    amountUsed: 0,
    balance: 2_500,
    currencySupported: true,
    loading: false,
    payWithWallet: false,
    redemptionAllowed: true,
    remainingAmount: 107_500,
    setPayWithWallet,
  },
  checkoutValues: { payWithWallet: false, discountAmount: 0 },
  payForMe: { isValid: true },
  redvault: { orderReady: false, summary: null },
  discount: { applied: null, setApplied: vi.fn() },
};

function makeInput(
  overrides: Partial<CheckoutScreenModelInput> = {}
): CheckoutScreenModelInput {
  const formValues = {
    firstName: 'Ada',
    lastName: 'Okon',
    customerEmail: 'ada@example.test',
    customerPhone: '+2348031234567',
    deliveryMethod: 'door',
    airportType: 'delivery',
    airportRequiresQuote: false,
    newAddressStreet: '12 Broad Street',
    newAddressCity: 'Lagos Island',
    newAddressState: 'Lagos',
    newsletterOptIn: false,
  };
  const display = {
    displayItems: [{ kind: 'cart', id: 'product-1', name: 'Phone' }],
    effectiveCheckoutCartTotal: 100_000,
    effectiveItemSubtotal: 100_000,
    summarySubtotal: 100_000,
    hasCheckoutCartItems: true,
    mobileSummaryCart: [{ id: 'product-1', name: 'Phone' }],
  };
  const amounts = {
    summaryTaxAmount: 7_500,
    summaryDeliveryCost: 0,
    summaryGiftWrappingCost: 0,
    summaryDiscountAmount: 0,
    summaryDeliveryMethod: 'door',
    summaryOrderTotals: { total: 107_500, taxAmount: 7_500 },
    summaryTaxLabel: 'VAT',
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
          setNewsletterOptIn,
        },
        flow: {
          currentStep: 'payment',
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
      attempt: { resumeOrderId: null, resumedOrder: null, isProcessing: false },
      delivery: { quotes: { selectedId: 'quote-1' } },
      financial: {
        paymentSession,
        summaryAmounts: amounts,
      },
      execution: {
        crypto: { setPendingCryptoOrder: vi.fn() },
        dva: {
          dvaData: null,
          isVerifyingDva: false,
          isInitializingDva: false,
          closeDvaModal: vi.fn(),
          handleDvaConfirmTransfer: onConfirmTransfer,
        },
        handlePlaceOrder,
        walletFundedTransfer: { start: vi.fn(), account: null, intent: null },
      },
    },
    display: {
      checkoutDisplay: display,
      checkoutCart: [{ id: 'product-1', name: 'Phone' }],
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
  return {
    ...defaults,
    ...overrides,
  } as unknown as CheckoutScreenModelInput;
}

describe('deriveCheckoutScreenModel', () => {
  it('projects fresh form, delivery, payment and action identities into the screen', () => {
    const model = deriveCheckoutScreenModel(makeInput());

    expect(model.steps.contact.values).toEqual({
      firstName: 'Ada',
      lastName: 'Okon',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348031234567',
    });
    expect(model.steps.delivery.address).toMatchObject({
      street: '12 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      merchantCountry: 'NG',
      isHydrated: true,
    });
    expect(model.steps.payment.session).toBe(paymentSession);
    expect(model.steps.payment.handlePlaceOrder).toBe(handlePlaceOrder);
    expect(model.steps.payment.setNewsletterOptIn).toBe(setNewsletterOptIn);
    expect(model.page.onReturnToCart).toBe(onReturnToCart);
    expect(model.overlays.dva.onConfirmTransfer).toBe(onConfirmTransfer);
    expect(model.summary.presentation.discount).toMatchObject({
      visible: true,
      merchantId: 'merchant-1',
      cartTotal: 100_000,
      productIds: ['product-1'],
    });
  });

  it('keeps resumed order totals authoritative and hides its local discount input', () => {
    const resumed = makeInput({
      sessions: {
        ...makeInput().sessions,
        attempt: {
          resumeOrderId: 'order-resume-1',
          resumedOrder: {
            id: 'order-resume-1',
          } as unknown as CheckoutScreenModelInput['sessions']['attempt']['resumedOrder'],
          isProcessing: false,
        },
      },
      display: {
        ...makeInput().display,
        checkoutDisplay: {
          ...makeInput().display.checkoutDisplay,
          hasCheckoutCartItems: false,
          effectiveCheckoutCartTotal: 107_500,
          effectiveItemSubtotal: 100_000,
          summarySubtotal: 100_000,
        },
      },
    });
    const model = deriveCheckoutScreenModel(resumed);

    expect(model.summary.payment).toBe(paymentSession);
    expect(model.summary.presentation.mobile).toMatchObject({
      cartTotal: 100_000,
      taxAmount: 7_500,
      deliveryCost: 0,
    });
    expect(model.summary.presentation.discount.visible).toBe(false);
    expect(model.summary.presentation.discount.cartTotal).toBe(107_500);
  });

  it('preserves wallet amount and selection callback identities', () => {
    const model = deriveCheckoutScreenModel(makeInput());

    expect(model.summary.presentation.desktop).toMatchObject({
      walletBalance: 2_500,
      remainingAmount: 107_500,
      payWithWallet: false,
    });
    expect(model.summary.presentation.desktop.setPayWithWallet).toBe(
      setPayWithWallet
    );
    expect(model.summary.payment.total).toBe(107_500);
  });
});
