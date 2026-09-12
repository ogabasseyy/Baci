'use client';

import { useEffect, useRef, useState } from 'react';
import { requestCryptoPaymentInitialization, type CryptoInitialization } from './request-crypto-payment-initialization';
import type { CryptoPaymentData } from './types';

type Input = Parameters<typeof requestCryptoPaymentInitialization>[0];
type RunningRequest = { controller: AbortController; promise: Promise<CryptoPaymentData> };

/** Session identity survives dismissal; cancelled attempts cannot update the UI. */
export function useCryptoPaymentInitializer(options: {
  onReady?: (payment: CryptoPaymentData) => void;
  onError?: (error: unknown) => void;
} = {}) {
  const sessions = useRef(new Map<string, CryptoInitialization>());
  const requests = useRef(new Map<string, RunningRequest>());
  const generation = useRef(0);
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    const active = requests.current;
    return () => {
      generation.current++;
      for (const request of active.values()) request.controller.abort();
    };
  }, []);

  function cancel() {
    generation.current++;
    for (const request of requests.current.values()) request.controller.abort();
    setIsInitializing(false);
  }

  function initialize(input: Input): Promise<CryptoPaymentData> {
    const key = JSON.stringify([input.merchantId, input.pendingOrder.orderId, input.chain, input.currency]);
    const version = generation.current;
    const running = requests.current.get(key);
    if (running) {
      if (!running.controller.signal.aborted) return running.promise;
      // Wait for an in-flight POST to return its IDs before starting another attempt.
      return running.promise.catch(() => undefined).then(() => {
        if (version !== generation.current) throw new DOMException('Payment selection dismissed', 'AbortError');
        return initialize(input);
      });
    }
    const controller = new AbortController();
    setIsInitializing(true);
    const promise = requestCryptoPaymentInitialization({
      ...input,
      signal: controller.signal,
      pendingSession: sessions.current.get(key),
      onPendingSession: session => { sessions.current.set(key, session); },
      onTerminalSession: () => { sessions.current.delete(key); },
    }).then(payment => {
      controller.signal.throwIfAborted();
      if (version === generation.current) options.onReady?.(payment);
      return payment;
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && version === generation.current) options.onError?.(error);
      throw error;
    }).finally(() => {
      if (requests.current.get(key)?.controller === controller) requests.current.delete(key);
      if (version === generation.current) setIsInitializing(false);
    });
    requests.current.set(key, { controller, promise });
    return promise;
  }

  return { initialize, cancel, isInitializing };
}
