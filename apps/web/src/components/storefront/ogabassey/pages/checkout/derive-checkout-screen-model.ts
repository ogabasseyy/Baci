import type { CartItem } from '@/hooks/cart';
import type { MerchantData } from '@/hooks/merchant/types';
import type { CheckoutScreenProps } from './components/CheckoutScreen';
import type { deriveCheckoutDisplayModel } from './derive-checkout-display-model';
import { deriveCheckoutOrderSummaryPresentation } from './derive-checkout-order-summary-presentation';
import type { useCheckoutAttemptSession } from './hooks/use-checkout-attempt-session';
import type { useCheckoutDeliverySession } from './hooks/use-checkout-delivery-session';
import type { useCheckoutFinancialSession } from './hooks/use-checkout-financial-session';
import type { useCheckoutFormSession } from './hooks/use-checkout-form-session';
import type { useCheckoutPaymentExecution } from './hooks/use-checkout-payment-execution';

type CheckoutFormSession = ReturnType<typeof useCheckoutFormSession>;
type CheckoutAttemptSession = ReturnType<typeof useCheckoutAttemptSession>;
type CheckoutDeliverySession = ReturnType<typeof useCheckoutDeliverySession>;
type CheckoutFinancialSession = ReturnType<typeof useCheckoutFinancialSession>;
type CheckoutPaymentExecution = ReturnType<typeof useCheckoutPaymentExecution>;

export interface CheckoutScreenModelInput {
  sessions: {
    form: CheckoutFormSession;
    attempt: Pick<
      CheckoutAttemptSession,
      'resumeOrderId' | 'resumedOrder' | 'isProcessing'
    >;
    delivery: CheckoutDeliverySession;
    financial: Pick<
      CheckoutFinancialSession,
      'paymentSession' | 'summaryAmounts'
    >;
    execution: Pick<
      CheckoutPaymentExecution,
      'crypto' | 'dva' | 'handlePlaceOrder' | 'walletFundedTransfer'
    >;
  };
  display: {
    checkoutDisplay: ReturnType<typeof deriveCheckoutDisplayModel>;
    checkoutCart: CartItem[];
    isHydrated: boolean;
  };
  identity: {
    merchant: MerchantData | null | undefined;
    user: CheckoutScreenProps['steps']['payment']['user'];
    currencyCode: string;
    currencySymbol: string;
    merchantCountry: string;
    formatCurrencyAuto: CheckoutScreenProps['page']['formatCurrency'];
  };
  actions: {
    onReturnToCart: CheckoutScreenProps['page']['onReturnToCart'];
  };
  availability: {
    redvaultAvailable: boolean;
  };
}

/** Maps authoritative checkout sessions into the screen's presentation contract. */
export function deriveCheckoutScreenModel({
  sessions,
  display,
  identity,
  actions,
  availability,
}: CheckoutScreenModelInput): CheckoutScreenProps {
  const { form, attempt, delivery, financial, execution } = sessions;
  const { paymentSession, summaryAmounts } = financial;
  const { values } = form.form;
  const { merchant, user } = identity;
  const { handlePlaceOrder } = execution;
  const isPayForMeValid = paymentSession.payForMe.isValid;
  const productIds = display.checkoutCart.map((item) => item.id);

  const presentation = deriveCheckoutOrderSummaryPresentation({
    display: display.checkoutDisplay,
    amounts: summaryAmounts,
    formatCurrencyAuto: identity.formatCurrencyAuto,
    paymentMethod: paymentSession.method,
    selectedQuoteId: delivery.quotes.selectedId,
    wallet: {
      currencySupported: paymentSession.wallet.currencySupported,
      redemptionAllowed: paymentSession.wallet.redemptionAllowed,
      loading: paymentSession.wallet.loading,
      balance: paymentSession.wallet.balance,
      payWithWallet: paymentSession.wallet.payWithWallet,
      setPayWithWallet: paymentSession.wallet.setPayWithWallet,
      amountUsed: paymentSession.wallet.amountUsed,
      remainingAmount: paymentSession.wallet.remainingAmount,
      checkoutPayWithWallet: paymentSession.checkoutValues.payWithWallet,
    },
    hasUser: Boolean(user),
    currencySymbol: identity.currencySymbol,
    redvaultSummary: paymentSession.redvault.summary,
    newsletterOptIn: values.newsletterOptIn,
    setNewsletterOptIn: form.form.setNewsletterOptIn,
    handlePlaceOrder,
    isProcessing: attempt.isProcessing,
    isPayForMeValid,
    merchantId: merchant?.id || '',
    merchantCountry: merchant?.country ?? 'NG',
    payoutCurrency: merchant?.payout_currency ?? null,
    productIds,
    resumeOrderId: attempt.resumeOrderId,
    hasResumedOrder: Boolean(attempt.resumedOrder),
  });

  const steps: CheckoutScreenProps['steps'] = {
    flow: form.flow,
    onSignIn: form.auth.open,
    contact: {
      values: form.form.contactValues,
      onChange: form.form.setField,
      onComplete: form.flow.completeContact,
      account: form.account,
    },
    delivery: {
      session: delivery,
      address: {
        street: values.newAddressStreet,
        city: values.newAddressCity,
        state: values.newAddressState,
        merchantCountry: identity.merchantCountry,
        isHydrated: display.isHydrated,
      },
    },
    payment: {
      session: paymentSession,
      isProcessing: attempt.isProcessing,
      isPayForMeValid,
      isInitializingDva: execution.dva.isInitializingDva,
      newsletterOptIn: values.newsletterOptIn,
      setNewsletterOptIn: form.form.setNewsletterOptIn,
      handlePlaceOrder,
      merchant,
      user,
      currency: identity.currencyCode,
      redvaultAvailable: availability.redvaultAvailable,
      redvaultOrderReady: Boolean(paymentSession.redvault.orderReady),
    },
  };

  return {
    page: {
      onReturnToCart: actions.onReturnToCart,
      merchantName: merchant?.business_name,
      formatCurrency: identity.formatCurrencyAuto,
    },
    auth: {
      isOpen: form.auth.isOpen,
      onOpenChange: form.auth.onOpenChange,
      onSuccess: form.auth.close,
    },
    overlays: {
      crypto: execution.crypto,
      walletFundedTransfer: execution.walletFundedTransfer,
      dva: {
        data: execution.dva.dvaData,
        isVerifying: execution.dva.isVerifyingDva,
        onClose: execution.dva.closeDvaModal,
        onConfirmTransfer: execution.dva.handleDvaConfirmTransfer,
      },
    },
    summary: { presentation, payment: paymentSession },
    steps,
  };
}
