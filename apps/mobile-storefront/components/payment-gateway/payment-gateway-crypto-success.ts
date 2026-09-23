import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { PAYMENT_KINDS, type PaymentKind } from './payment-gateway.helpers';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

export interface CryptoSuccessMessageDeps {
  amount?: number;
  clearCart: () => void | Promise<void>;
  confirmVtuPaymentSuccess: (input: {
    amount: number;
    customerIdentifier?: string;
    reference: string;
  }) => void;
  customerIdentifier?: string;
  gateway?: string;
  isMountedRef?: MutableRefObject<boolean>;
  markPaymentCompletionStarted: () => boolean;
  onTerminalVerificationFailure: (
    terminalFailure: 'failed' | 'cancelled' | 'abandoned'
  ) => void;
  orderId?: string;
  orderNumber?: string;
  orderTotal?: number;
  paymentKind?: PaymentKind;
  reference?: string;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setProcessingStatus: () => void;
  setSuccessStatus: () => void;
  trackingToken?: string;
  utilityType?: string;
}

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const getFiniteNumber = (value: unknown) => {
  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  const numberValue =
    typeof value === 'number'
      ? value
      : trimmedValue
        ? Number(trimmedValue)
        : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

/**
 * Handles a `crypto_success` WebView message: VTU routing, verification,
 * first-wins conversion, terminal-failure and reconciliation branches,
 * then cart clear and success navigation. Awaits can run for seconds, so
 * the post-await cart clear rechecks controller liveness — a shopper who
 * left and built a new cart must not have it erased by a stale handler.
 * Extracted from create-payment-gateway-message-handler (300-line limit).
 */
export async function handleCryptoSuccessMessage(
  data: Record<string, unknown>,
  deps: CryptoSuccessMessageDeps
): Promise<void> {
  const {
    amount,
    clearCart,
    confirmVtuPaymentSuccess,
    customerIdentifier,
    gateway,
    isMountedRef,
    markPaymentCompletionStarted,
    onTerminalVerificationFailure,
    orderId,
    orderNumber,
    orderTotal,
    paymentKind,
    reference,
    scheduleDelayedNavigation,
    setProcessingStatus,
    setSuccessStatus,
    trackingToken,
    utilityType,
  } = deps;
  const cryptoOrderId =
    getTrimmedString(data.orderId) || getTrimmedString(orderId);
  const cryptoReference =
    getTrimmedString(data.reference) || getTrimmedString(reference);

  if (paymentKind === PAYMENT_KINDS.VTU) {
    const cryptoAmount = getFiniteNumber(data.amount) ?? amount ?? 0;
    const cryptoCustomerIdentifier =
      getTrimmedString(data.customerIdentifier) ||
      getTrimmedString(customerIdentifier);
    if (!utilityType || !cryptoReference || cryptoAmount <= 0) {
      console.error('Unable to route VTU crypto payment success:', {
        amount: cryptoAmount,
        hasReference: Boolean(cryptoReference),
        hasUtilityType: Boolean(utilityType),
      });
      return;
    }

    confirmVtuPaymentSuccess({
      amount: cryptoAmount,
      ...(cryptoCustomerIdentifier && {
        customerIdentifier: cryptoCustomerIdentifier,
      }),
      reference: cryptoReference,
    });
    return;
  }

  if (!cryptoOrderId || !cryptoReference) {
    console.error('Unable to route crypto payment success:', {
      hasOrderId: Boolean(cryptoOrderId),
      hasReference: Boolean(cryptoReference),
    });
    return;
  }

  if (!markPaymentCompletionStarted()) {
    return;
  }
  // Stay processing until verification decides: an early success would
  // render success UI and terminally ignore later provider
  // cancellation/error callbacks while verification is still running.
  setProcessingStatus();
  // Prefer the canonical order total: `amount` is only the residual due
  // at the gateway after wallet/savings credits.
  const cryptoPurchaseTotal = orderTotal ?? amount ?? 0;
  // A crypto callback proves association, not settlement: read the
  // token-scoped tracked order before claiming so the durable claim is
  // consumed with the checkout identity and breakdown (guests have no
  // cached identity and later polling cannot enrich the claim).
  const cryptoVerification = await verifyOrderPaymentForCompletion({
    orderId: cryptoOrderId,
    reference: cryptoReference,
    trackingToken,
  });
  if (cryptoVerification.paid) {
    // First completion wins the durable claim; replays emit nothing.
    // Unverified orders still navigate to success, where settlement
    // polling may complete them once the webhook marks them paid.
    await trackCheckoutPaymentCompletedOnce({
      customerEmail: cryptoVerification.customerEmail,
      customerPhone: cryptoVerification.customerPhone,
      items: cryptoVerification.items,
      orderId: cryptoOrderId,
      orderNumber: getTrimmedString(orderNumber) || cryptoOrderId,
      paymentMethod: getTrimmedString(gateway) || 'crypto',
      reference: cryptoReference,
      shipping: cryptoVerification.shipping,
      subtotal: cryptoVerification.subtotal,
      tax: cryptoVerification.tax,
      value: cryptoVerification.total ?? cryptoPurchaseTotal,
      // Verified order currency: absent values fall back to NGN for
      // the funnel event and any fallback purchase, mislabeling
      // every non-NGN crypto conversion.
      ...(cryptoVerification.currency
        ? { currency: cryptoVerification.currency }
        : {}),
    });
  } else if (cryptoVerification.terminalFailure) {
    // Definitive gateway outcome: the payment cannot settle, so keep
    // the cart and the error/retry path instead of navigating to a
    // false "Order Confirmed".
    onTerminalVerificationFailure(cryptoVerification.terminalFailure);
    return;
  } else if (cryptoVerification.reconciliation) {
    // Captured money with no active paid order: route to the
    // reconciliation state instead of the generic confirmation, with
    // the cart intact for a fresh attempt.
    setSuccessStatus();
    scheduleDelayedNavigation(() => {
      router.replace({
        pathname: '/order-success',
        params: {
          orderId: cryptoOrderId,
          orderNumber: getTrimmedString(orderNumber),
          paymentMethod: getTrimmedString(gateway) || 'crypto',
          reference: cryptoReference,
          reconciliation: cryptoVerification.reconciliation,
          ...(getTrimmedString(trackingToken) && {
            trackingToken: getTrimmedString(trackingToken),
          }),
        },
      });
    });
    return;
  }
  // The verification and tracking awaits above can run for seconds:
  // a shopper who left and built a new cart must not have it erased
  // by this stale handler. Navigation stays self-guarded inside
  // scheduleDelayedNavigation.
  if (isMountedRef && !isMountedRef.current) {
    return;
  }
  setSuccessStatus();
  await clearCart();
  scheduleDelayedNavigation(() => {
    router.replace({
      pathname: '/order-success',
      params: {
        orderId: cryptoOrderId,
        orderNumber: getTrimmedString(orderNumber),
        paymentMethod: getTrimmedString(gateway) || 'crypto',
        reference: cryptoReference,
        ...(getTrimmedString(trackingToken) && {
          trackingToken: getTrimmedString(trackingToken),
        }),
      },
    });
  });
}
