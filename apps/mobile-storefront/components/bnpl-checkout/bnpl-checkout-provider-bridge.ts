import type { MutableRefObject } from 'react';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import type {
  BNPLCheckoutStatus,
  BNPLRecordCheckoutFailure,
  BNPLSetCheckoutStatus,
} from './use-bnpl-checkout-controller';

export interface BNPLProviderBridgeDeps {
  gateway?: string;
  orderId?: string;
  amount?: string;
  /** Canonical order total: `amount` is only the residual provider
   * charge after wallet/savings credit, but started revenue is the
   * whole order — matching the completion path. */
  orderTotal?: string;
  statusRef: MutableRefObject<BNPLCheckoutStatus>;
  paymentStartRecordedRef: MutableRefObject<boolean>;
  setCheckoutStatus: BNPLSetCheckoutStatus;
  setErrorMessage: (message: string | null) => void;
  clearPendingLoadTimeout: () => void;
  recordCheckoutFailure: BNPLRecordCheckoutFailure;
}

/**
 * WebView bridge handlers for the launcher's provider lifecycle signals:
 * the opened confirmation (which records the funnel start) and the
 * opened-attempt failure. Extracted from
 * use-bnpl-checkout-controller (300-line file limit).
 */
export function createBNPLProviderBridgeHandlers({
  gateway,
  orderId,
  amount,
  orderTotal,
  statusRef,
  paymentStartRecordedRef,
  setCheckoutStatus,
  setErrorMessage,
  clearPendingLoadTimeout,
  recordCheckoutFailure,
}: BNPLProviderBridgeDeps) {
  // The start is recorded only once the launcher confirms the provider
  // flow opened: initialization failures before that point (order lookup,
  // SDK load, popup creation) must not count as a start. A ref (not state)
  // so duplicate opened signals cannot double-emit.
  const handleProviderOpenedMessage = ({
    gateway: openedGateway,
    orderId: openedOrderId,
    reference: openedReference,
  }: {
    gateway?: string;
    orderId?: string;
    reference?: string;
  }) => {
    if (paymentStartRecordedRef.current || !orderId) {
      return;
    }
    if (openedGateway && gateway && openedGateway !== gateway) {
      return;
    }
    if (openedOrderId && openedOrderId !== orderId) {
      return;
    }
    paymentStartRecordedRef.current = true;
    void trackCheckoutPaymentStarted({
      orderId,
      paymentMethod: gateway || 'bnpl',
      reference: openedReference,
      value: orderTotal
        ? Number(orderTotal)
        : amount
          ? Number(amount)
          : undefined,
    });
  };

  // Attempt-scoped failure bridged from the web launcher when an opened
  // provider's SDK fails (decline or runtime error): without this the
  // native funnel keeps the start from bnpl_provider_opened with no
  // matching failure. Late callbacks after success are ignored, like
  // provider error redirects.
  const handleProviderErrorMessage = ({
    gateway: errorGateway,
    orderId: errorOrderId,
    message,
    reference: errorReference,
  }: {
    gateway?: string;
    orderId?: string;
    message?: string;
    reference?: string;
  }) => {
    if (statusRef.current === 'success') {
      return;
    }
    if (errorGateway && gateway && errorGateway !== gateway) {
      return;
    }
    if (errorOrderId && errorOrderId !== orderId) {
      return;
    }
    recordCheckoutFailure('bnpl_provider_error', errorReference);
    clearPendingLoadTimeout();
    setCheckoutStatus('error');
    setErrorMessage(message || 'The provider checkout failed.');
  };

  return { handleProviderErrorMessage, handleProviderOpenedMessage };
}
