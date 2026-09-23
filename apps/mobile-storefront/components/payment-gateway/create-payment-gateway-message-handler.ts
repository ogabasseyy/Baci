import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import {
  isPlainRecord,
  PAYMENT_KINDS,
  type PaymentKind,
} from './payment-gateway.helpers';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

interface CreatePaymentGatewayMessageHandlerInput {
  confirmRedvaultPayment?: () => void;
  amount?: number;
  clearCart: () => void | Promise<void>;
  confirmVtuPaymentSuccess: (input: {
    amount: number;
    customerIdentifier?: string;
    reference: string;
  }) => void;
  copiedGatewayTextRef: MutableRefObject<string | null>;
  copyGatewayText: (
    text: string,
    successMessage: string,
    failureMessage?: string
  ) => Promise<void>;
  gateway?: string;
  customerIdentifier?: string;
  orderId?: string;
  orderNumber?: string;
  orderTotal?: number;
  paymentKind?: PaymentKind;
  reference?: string;
  trackingToken?: string;
  utilityType?: string;
  markPaymentCompletionStarted: () => boolean;
  onTerminalVerificationFailure: (
    terminalFailure: 'failed' | 'cancelled' | 'abandoned'
  ) => void;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setSuccessStatus: () => void;
  /**
   * Controller liveness: the crypto verification/tracking awaits can run
   * for seconds, and a shopper who left and built a new cart must not
   * have it erased by this stale handler. Optional so existing callers
   * and tests without a controller keep today's behavior.
   */
  isMountedRef?: MutableRefObject<boolean>;
}

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

function handleClipboardText({
  copiedGatewayTextRef,
  copyGatewayText,
  failureMessage,
  pendingGatewayTextRef,
  successMessage,
  text,
}: {
  copiedGatewayTextRef: MutableRefObject<string | null>;
  copyGatewayText: (
    text: string,
    successMessage: string,
    failureMessage?: string
  ) => Promise<void>;
  failureMessage?: string;
  pendingGatewayTextRef: MutableRefObject<string | null>;
  successMessage: string;
  text: unknown;
}) {
  const copiedText = getTrimmedString(text);
  if (
    !copiedText ||
    copiedGatewayTextRef.current === copiedText ||
    pendingGatewayTextRef.current === copiedText
  ) {
    return;
  }

  pendingGatewayTextRef.current = copiedText;
  try {
    void copyGatewayText(copiedText, successMessage, failureMessage).then(
      () => {
        copiedGatewayTextRef.current = copiedText;
        if (pendingGatewayTextRef.current === copiedText) {
          pendingGatewayTextRef.current = null;
        }
      },
      () => {
        if (copiedGatewayTextRef.current === copiedText) {
          copiedGatewayTextRef.current = null;
        }
        if (pendingGatewayTextRef.current === copiedText) {
          pendingGatewayTextRef.current = null;
        }
      }
    );
  } catch {
    if (pendingGatewayTextRef.current === copiedText) {
      pendingGatewayTextRef.current = null;
    }
  }
}

export function createPaymentGatewayMessageHandler({
  amount,
  confirmRedvaultPayment,
  clearCart,
  confirmVtuPaymentSuccess,
  copiedGatewayTextRef,
  copyGatewayText,
  customerIdentifier,
  gateway,
  orderId,
  orderNumber,
  orderTotal,
  paymentKind,
  reference,
  trackingToken,
  utilityType,
  markPaymentCompletionStarted,
  onTerminalVerificationFailure,
  scheduleDelayedNavigation,
  setSuccessStatus,
  isMountedRef,
}: CreatePaymentGatewayMessageHandlerInput) {
  const pendingGatewayTextRef: MutableRefObject<string | null> = {
    current: null,
  };

  return async (event: { nativeEvent: { data: string } }) => {
    let data: unknown;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (!isPlainRecord(data)) {
      return;
    }

    if (data.type === PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType) {
      handleClipboardText({
        copiedGatewayTextRef,
        copyGatewayText,
        pendingGatewayTextRef,
        successMessage: 'Text copied.',
        text: data.text,
      });
      return;
    }

    if (data.type === PAYMENT_CLIPBOARD_BRIDGE.accountNumberMessageType) {
      handleClipboardText({
        copiedGatewayTextRef,
        copyGatewayText,
        failureMessage: 'Unable to copy account number.',
        pendingGatewayTextRef,
        successMessage: 'Account number copied.',
        text: data.text,
      });
      return;
    }

    if (confirmRedvaultPayment) {
      if (
        data.type === 'crypto_success' ||
        data.type === 'success' ||
        data.type === 'payment_success'
      )
        confirmRedvaultPayment();
      return;
    }

    if (data.type === 'crypto_success') {
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
      setSuccessStatus();
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
      return;
    }
  };
}
