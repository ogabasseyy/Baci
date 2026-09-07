'use client';

import { useRef } from 'react';
import { requestCryptoPaymentInitialization, type CryptoInitialization } from './request-crypto-payment-initialization';

/** Keep delayed addresses attached to their original order and payment network. */
export function useCryptoPaymentInitializer() {
  const sessions = useRef(new Map<string, CryptoInitialization>());
  const requests = useRef(new Map<string, ReturnType<typeof requestCryptoPaymentInitialization>>());
  return (input: Parameters<typeof requestCryptoPaymentInitialization>[0]) => {
    const key = JSON.stringify([input.merchantId, input.pendingOrder.orderId, input.chain, input.currency]);
    const running = requests.current.get(key);
    if (running) return running;
    const request = requestCryptoPaymentInitialization({
      ...input,
      pendingSession: sessions.current.get(key),
      onPendingSession: session => { sessions.current.set(key, session); },
    }).finally(() => { requests.current.delete(key); });
    requests.current.set(key, request);
    return request;
  };
}
