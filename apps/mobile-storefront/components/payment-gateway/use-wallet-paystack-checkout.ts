import { type RefObject, useRef, useState } from 'react';
import { PAYMENT_PAGE_INTERACTIVE_MESSAGE } from '@/constants/payment-page-interactive-bridge';
import { PAYMENT_LOAD_TIMEOUT_MESSAGE } from './payment-gateway-controller.helpers';
import type {
  PaymentGatewayStatus,
  PaymentStatusSetter,
} from './payment-gateway-controller.types';

export function useWalletPaystackCheckout({
  enabled,
  setErrorMessage,
  setPaymentStatus,
  statusRef,
}: {
  enabled: boolean;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
  statusRef: RefObject<PaymentGatewayStatus>;
}) {
  const [interactive, setInteractive] = useState(false);
  const interactiveRef = useRef(false);
  const [stalled, setStalled] = useState(false);

  const handleMessage = (raw: string) => {
    if (!enabled || statusRef.current !== 'loading') return false;
    try {
      const data: unknown = JSON.parse(raw);
      if (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        data.type === PAYMENT_PAGE_INTERACTIVE_MESSAGE
      ) {
        interactiveRef.current = true;
        setInteractive(true);
        return true;
      }
    } catch {
      // The normal message handler also ignores malformed messages.
    }
    return false;
  };

  const onLoadTimeout = () => {
    if (!enabled || !interactiveRef.current) return false;
    // A subresource may prevent a load event even though the checkout can be used.
    setStalled(true);
    return true;
  };

  const onLoadStart = () => {
    if (
      enabled &&
      (statusRef.current === 'loading' || statusRef.current === 'ready')
    ) {
      interactiveRef.current = false;
      setInteractive(false);
      setStalled(false);
    }
  };

  const onLoadEnd = () => {
    if (enabled && statusRef.current === 'ready') setStalled(false);
  };

  const showRecovery = (clearPendingLoadTimeout: () => void) => {
    if (!enabled || statusRef.current !== 'loading') return;
    clearPendingLoadTimeout();
    setErrorMessage(PAYMENT_LOAD_TIMEOUT_MESSAGE);
    setPaymentStatus('error');
  };

  return {
    handleMessage,
    interactive,
    onLoadEnd,
    onLoadStart,
    onLoadTimeout,
    showRecovery,
    stalled,
  };
}
