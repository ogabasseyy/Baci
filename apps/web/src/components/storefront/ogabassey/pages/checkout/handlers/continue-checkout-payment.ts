import { toast } from '@/hooks/use-toast';
import { completeCheckoutOrder } from './complete-checkout-order';
import { dispatchCheckoutPayment } from './dispatch-checkout-payment';
import type { CheckoutPaymentDispatchContext } from './checkout-payment-dispatch-context';
import type {
  CheckoutPaymentOrder,
  CheckoutWalletRedemption,
} from './submit-checkout-order';
import { isKlumpUnavailableForGatewayAmount, KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST } from '../utils';

type DispatchBase = Omit<
  CheckoutPaymentDispatchContext,
  | 'order'
  | 'paymentAmount'
  | 'createdOrderNumber'
  | 'orderChargeCurrency'
  | 'capturePaymentStarted'
  | 'hasPaymentStarted'
  | 'setInitializedReference'
  | 'completeSignup'
>;

export interface ContinueCheckoutPaymentOptions {
  dispatch: DispatchBase;
  order: CheckoutPaymentOrder;
  wallet: CheckoutWalletRedemption | null;
  amountDueToGateway: number;
  createdOrderNumber: string;
  orderChargeCurrency: string;
  checkoutFingerprint: string;
  paymentMethod: CheckoutPaymentDispatchContext['paymentMethod'];
  setWalletBalance: (balance: number) => void;
  capturePaymentStarted: (reference?: string) => void;
  hasPaymentStarted: () => boolean;
  setInitializedReference: (reference: string | undefined) => void;
  completeSignup: () => Promise<void>;
  signupBeforePayment?: () => Promise<void>;
  releaseSubmission: () => void;
}

/** Run the post-order path: optional signup, zero-due completion, or provider dispatch. */
export async function continueCheckoutPayment({
  dispatch,
  order,
  wallet,
  amountDueToGateway,
  createdOrderNumber,
  orderChargeCurrency,
  checkoutFingerprint,
  paymentMethod,
  setWalletBalance,
  capturePaymentStarted,
  hasPaymentStarted,
  setInitializedReference,
  completeSignup,
  signupBeforePayment,
  releaseSubmission,
}: ContinueCheckoutPaymentOptions): Promise<void> {
  const paymentAmount = amountDueToGateway ?? dispatch.total;

  if (
    isKlumpUnavailableForGatewayAmount({
      paymentMethod,
      payableAmount: paymentAmount,
      orderAmount: dispatch.total,
    })
  ) {
    toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
    releaseSubmission();
    return;
  }

  if (signupBeforePayment) await signupBeforePayment();

  const capturePaymentStartedForOrder = (reference?: string) => {
    capturePaymentStarted(reference);
  };

  if (wallet?.amountUsed) setWalletBalance(wallet.newBalance);

  if (paymentMethod !== 'uba_redvault' && paymentAmount <= 0) {
    await completeCheckoutOrder({
      order,
      checkoutFingerprint,
      completion: {
        kind: 'zero_due',
        paymentMethod,
        currency: orderChargeCurrency,
        orderNumber: createdOrderNumber,
        total: dispatch.total,
      },
      clearPendingCheckoutOrder: dispatch.clearPendingCheckoutOrder,
      clearCheckoutSession: dispatch.clearCheckoutSession,
      clearCart: dispatch.clearCart,
      pushSuccessRoute: dispatch.navigate,
    });
    return;
  }

  await dispatchCheckoutPayment({
    ...dispatch,
    order,
    paymentAmount,
    createdOrderNumber,
    orderChargeCurrency,
    capturePaymentStarted: capturePaymentStartedForOrder,
    hasPaymentStarted,
    setInitializedReference,
    completeSignup,
  });
}
