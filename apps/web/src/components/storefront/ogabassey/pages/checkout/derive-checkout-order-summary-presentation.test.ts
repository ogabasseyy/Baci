import { describe, expect, it, vi } from 'vitest';
import type { deriveCheckoutDisplayModel } from './derive-checkout-display-model';
import { deriveCheckoutOrderSummaryPresentation } from './derive-checkout-order-summary-presentation';
import type { deriveCheckoutSummaryAmounts } from './derive-checkout-summary-amounts';

const display = {
  displayItems: [{ kind: 'resumed', id: 'line-1' }],
  effectiveCheckoutCartTotal: 1_300,
  effectiveItemSubtotal: 1_000,
  summarySubtotal: 1_000,
  hasCheckoutCartItems: false,
  mobileSummaryCart: [{ id: 'product-1', name: 'Resumed product' }],
  summaryOrder: { id: 'order-1' },
} as unknown as ReturnType<typeof deriveCheckoutDisplayModel>;

const amounts = {
  summaryOrder: { id: 'order-1' },
  summaryTaxAmount: 100,
  summaryDeliveryCost: 200,
  summaryGiftWrappingCost: 0,
  summaryDiscountAmount: 50,
  summaryDeliveryMethod: null,
  summaryOrderTotals: { total: 1_300, taxAmount: 100 },
  summaryTaxLabel: 'Tax',
} as ReturnType<typeof deriveCheckoutSummaryAmounts>;

function buildPresentation(
  overrides: Partial<
    Parameters<typeof deriveCheckoutOrderSummaryPresentation>[0]
  > = {}
) {
  return deriveCheckoutOrderSummaryPresentation({
    display,
    amounts,
    formatCurrencyAuto: (amount) => `₦${amount}`,
    paymentMethod: 'paystack',
    selectedQuoteId: '',
    wallet: {
      currencySupported: true,
      redemptionAllowed: true,
      loading: false,
      balance: 300,
      payWithWallet: true,
      setPayWithWallet: vi.fn(),
      amountUsed: 100,
      remainingAmount: 1_200,
      checkoutPayWithWallet: true,
    },
    hasUser: true,
    currencySymbol: '₦',
    redvaultSummary: null,
    newsletterOptIn: false,
    setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(),
    isProcessing: false,
    isPayForMeValid: true,
    merchantId: 'merchant-1',
    merchantCountry: 'NG',
    payoutCurrency: 'NGN',
    productIds: ['product-1'],
    resumeOrderId: 'order-1',
    hasResumedOrder: true,
    ...overrides,
  });
}

describe('deriveCheckoutOrderSummaryPresentation', () => {
  it('maps the same resumed order source into both summaries and hides local discounts', () => {
    const model = buildPresentation();

    expect(model.mobile).toMatchObject({
      cart: display.mobileSummaryCart,
      cartTotal: 1_000,
      deliveryCost: 200,
      taxAmount: 100,
      discountAmount: 50,
      remainingAmount: 1_200,
    });
    expect(model.desktop).toMatchObject({
      displayItems: display.displayItems,
      summarySubtotal: 1_000,
      orderTotals: { total: 1_300, taxAmount: 100 },
      taxLabel: 'Tax',
      remainingAmount: 1_200,
    });
    expect(model.discount).toMatchObject({
      visible: false,
      cartTotal: 1_300,
      productIds: ['product-1'],
    });
    expect(model.showMobile).toBe(true);
  });

  it('keeps discounts available for fresh checkout and hides mobile summary for Redvault', () => {
    const model = buildPresentation({
      paymentMethod: 'uba_redvault',
      resumeOrderId: null,
      hasResumedOrder: false,
    });

    expect(model.discount.visible).toBe(true);
    expect(model.showMobile).toBe(false);
  });

  it('uses the active cart as the discount source when cart and resumed order coexist', () => {
    const cartDisplay = {
      ...display,
      hasCheckoutCartItems: true,
      effectiveCheckoutCartTotal: 2_000,
      summarySubtotal: 2_000,
    } as ReturnType<typeof deriveCheckoutDisplayModel>;
    const model = buildPresentation({
      display: cartDisplay,
      resumeOrderId: 'order-1',
      hasResumedOrder: true,
    });

    expect(model.discount).toMatchObject({ visible: true, cartTotal: 2_000 });
    expect(model.mobile.cartTotal).toBe(2_000);
  });
});
