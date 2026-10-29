import type { MobileOrderSummaryProps } from '../../components/MobileOrderSummary';
import type { DesktopOrderSummaryProps } from './components/DesktopOrderSummary';
import type { RedvaultQuoteSummary } from './components/redvault/RedvaultPaymentOption';
import type { deriveCheckoutDisplayModel } from './derive-checkout-display-model';
import type { deriveCheckoutSummaryAmounts } from './derive-checkout-summary-amounts';
import type { PaymentMethod } from './types';

type CheckoutDisplayModel = ReturnType<typeof deriveCheckoutDisplayModel>;
type CheckoutSummaryAmounts = ReturnType<typeof deriveCheckoutSummaryAmounts>;

interface DeriveCheckoutOrderSummaryPresentationInput {
  display: CheckoutDisplayModel;
  amounts: CheckoutSummaryAmounts;
  formatCurrencyAuto: (amount: number) => string;
  paymentMethod: PaymentMethod;
  selectedQuoteId: string;
  wallet: {
    currencySupported: boolean;
    redemptionAllowed: boolean;
    loading: boolean;
    balance: number;
    payWithWallet: boolean;
    setPayWithWallet: (value: boolean) => void;
    amountUsed: number;
    remainingAmount: number;
    checkoutPayWithWallet: boolean;
  };
  hasUser: boolean;
  currencySymbol: string;
  redvaultSummary: RedvaultQuoteSummary | null;
  redvaultOrderReady: boolean;
  newsletterOptIn: boolean;
  setNewsletterOptIn: (value: boolean) => void;
  handlePlaceOrder: () => void | Promise<void>;
  isProcessing: boolean;
  isPayForMeValid: boolean;
  isDeliveryValid: boolean;
  merchantId: string;
  merchantCountry: string | null;
  payoutCurrency: string | null;
  productIds: string[];
  resumeOrderId: string | null;
  hasResumedOrder: boolean;
}

/**
 * Maps checkout pricing/session state into the page's mobile, desktop, and
 * discount presentation contracts. Keeping this mapping together ensures both
 * summaries follow the same cart-versus-resumed-order source of truth.
 */
export function deriveCheckoutOrderSummaryPresentation({
  display,
  amounts,
  formatCurrencyAuto,
  paymentMethod,
  selectedQuoteId,
  wallet,
  hasUser,
  currencySymbol,
  redvaultSummary,
  redvaultOrderReady,
  newsletterOptIn,
  setNewsletterOptIn,
  handlePlaceOrder,
  isProcessing,
  isPayForMeValid,
  isDeliveryValid,
  merchantId,
  merchantCountry,
  payoutCurrency,
  productIds,
  resumeOrderId,
  hasResumedOrder,
}: DeriveCheckoutOrderSummaryPresentationInput) {
  const confirmedRedvault =
    paymentMethod === 'uba_redvault' && redvaultOrderReady
      ? redvaultSummary
      : null;
  const mobile: MobileOrderSummaryProps = {
    cart: display.mobileSummaryCart,
    cartTotal: display.summarySubtotal,
    deliveryCost: amounts.summaryDeliveryCost,
    deliveryMethod: amounts.summaryDeliveryMethod,
    giftWrappingCost: amounts.summaryGiftWrappingCost,
    walletBalance: wallet.balance,
    payWithWallet: wallet.checkoutPayWithWallet,
    walletAmountUsed: wallet.amountUsed,
    remainingAmount: wallet.remainingAmount,
    taxAmount: amounts.summaryTaxAmount,
    discountAmount: amounts.summaryDiscountAmount,
  };

  const desktop: DesktopOrderSummaryProps = {
    displayItems: display.displayItems,
    formatCurrencyAuto,
    summarySubtotal: confirmedRedvault
      ? confirmedRedvault.productSubtotalKobo / 100
      : display.summarySubtotal,
    orderTotals: confirmedRedvault
      ? {
          total: confirmedRedvault.payableKobo / 100,
          taxAmount: confirmedRedvault.taxKobo / 100,
        }
      : amounts.summaryOrderTotals,
    taxLabel: amounts.summaryTaxLabel,
    deliveryCost: confirmedRedvault
      ? confirmedRedvault.shippingKobo / 100
      : amounts.summaryDeliveryCost,
    discountAmount: confirmedRedvault
      ? confirmedRedvault.discountKobo / 100
      : amounts.summaryDiscountAmount,
    deliveryMethod: amounts.summaryDeliveryMethod,
    selectedQuoteId,
    giftWrappingCost: confirmedRedvault
      ? confirmedRedvault.giftWrappingKobo / 100
      : amounts.summaryGiftWrappingCost,
    paymentMethod,
    walletCurrencySupported: wallet.currencySupported,
    walletRedemptionAllowed: wallet.redemptionAllowed,
    walletLoading: wallet.loading,
    walletBalance: wallet.balance,
    hasUser,
    currencySymbol,
    payWithWallet: wallet.payWithWallet,
    setPayWithWallet: wallet.setPayWithWallet,
    walletAmountUsed: wallet.amountUsed,
    remainingAmount: wallet.remainingAmount,
    checkoutPayWithWallet: wallet.checkoutPayWithWallet,
    redvaultSummary,
    redvaultOrderReady,
    newsletterOptIn,
    setNewsletterOptIn,
    handlePlaceOrder,
    isProcessing,
    isPayForMeValid,
    isDeliveryValid,
  };

  return {
    mobile,
    desktop,
    showMobile: paymentMethod !== 'uba_redvault',
    discount: {
      visible:
        display.hasCheckoutCartItems || (!resumeOrderId && !hasResumedOrder),
      merchantId,
      cartTotal: display.effectiveCheckoutCartTotal,
      currencyCountryCode: merchantCountry,
      payoutCurrency,
      productIds,
    },
  };
}
