import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';
import { trackCheckoutPaymentCompleted } from '@/services/analytics';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { useCartStore } from '@/stores/cart-store';
import {
  isPlainRecord,
  PAYMENT_KINDS,
  type PaymentKind,
} from './payment-gateway.helpers';

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

interface CreatePaymentGatewayMessageHandlerInput {
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
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setSuccessStatus: () => void;
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
  scheduleDelayedNavigation,
  setSuccessStatus,
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
      trackCheckoutPaymentCompleted({
        orderId: cryptoOrderId,
        orderNumber: getTrimmedString(orderNumber),
        paymentMethod: getTrimmedString(gateway) || 'crypto',
        reference: cryptoReference,
        value: cryptoPurchaseTotal,
      });
      trackCheckoutRoutePurchaseCompleted({
        items: useCartStore.getState().items,
        orderId: cryptoOrderId,
        orderNumber: getTrimmedString(orderNumber) || cryptoOrderId,
        paymentMethod: getTrimmedString(gateway) || 'crypto',
        shipping: 0,
        subtotal: cryptoPurchaseTotal,
        tax: 0,
        total: cryptoPurchaseTotal,
      });
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
