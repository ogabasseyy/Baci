import type { MutableRefObject } from 'react';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';
import { isPlainRecord, type PaymentKind } from './payment-gateway.helpers';
import { handleCryptoSuccessMessage } from './payment-gateway-crypto-success';

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

interface CreatePaymentGatewayMessageHandlerInput {
  confirmServerPayment?: () => void;
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
  setProcessingStatus: () => void;
  setSuccessStatus: () => void;
  /**
   * Controller liveness: the crypto verification/tracking awaits can run
   * for seconds, and a shopper who left and built a new cart must not
   * have it erased by this stale handler. Optional so existing callers
   * and tests without a controller keep today's behavior.
   */
  isMountedRef?: MutableRefObject<boolean>;
}

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
  confirmServerPayment,
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
  setProcessingStatus,
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

    // Primary card confirms only through the hosted status boundary:
    // route every success-claim message to the wired server confirmer
    // (or drop it when unwired) before any branch below can credit it.
    // Clipboard messages fall through; copying text never confirms.
    if (
      paymentKind === 'primary_wallet_card' &&
      (data.type === 'crypto_success' ||
        data.type === 'success' ||
        data.type === 'payment_success')
    ) {
      if (confirmServerPayment) confirmServerPayment();
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

    if (confirmServerPayment) {
      if (
        data.type === 'crypto_success' ||
        data.type === 'success' ||
        data.type === 'payment_success'
      )
        confirmServerPayment();
      return;
    }

    if (data.type === 'crypto_success') {
      // Intentional belt-and-braces: the early primary_wallet_card guard
      // above already returns for every success-claim type, so this inner
      // guard is unreachable today. It stays so a future narrowing of the
      // early guard cannot silently let a WebView crypto claim credit a
      // primary card checkout, which confirms only through hosted status.
      if (paymentKind === 'primary_wallet_card') return;
      await handleCryptoSuccessMessage(data, {
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
      });
      return;
    }
  };
}
