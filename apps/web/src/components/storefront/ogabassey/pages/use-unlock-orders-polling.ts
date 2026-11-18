import { useEffect, useState } from 'react';
import {
  type ImeiRemediationOrder,
  imeiRemediationApi,
} from './imei-remediation-api';

export const UNLOCK_ORDERS_POLL_INTERVAL_MS = 30_000;
export const UNLOCK_ORDERS_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_UNLOCK_ORDERS_POLL_ATTEMPTS = 60;

async function listWithTimeout(
  merchantSlug: string,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<ImeiRemediationOrder[]> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) {
    controller.abort(outerSignal.reason);
  } else if (outerSignal) {
    outerSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      imeiRemediationApi.list(merchantSlug, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Request timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    outerSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function useUnlockOrdersPolling(merchantSlug: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [orders, setOrders] = useState<ImeiRemediationOrder[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollGeneration intentionally resets the attempt budget on user retry.
  useEffect(() => {
    if (!merchantSlug) return;
    setPollingPaused(false);
    setError(null);
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    let latestRequestId = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    const unmountController = new AbortController();

    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const refresh = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (attempts >= MAX_UNLOCK_ORDERS_POLL_ATTEMPTS) {
        stopPolling();
        if (!cancelled) {
          setLoading(false);
          setPollingPaused(true);
        }
        return;
      }
      attempts += 1;
      inFlight = true;
      const requestId = ++latestRequestId;
      try {
        const result = await listWithTimeout(
          merchantSlug,
          UNLOCK_ORDERS_REQUEST_TIMEOUT_MS,
          unmountController.signal
        );
        if (!cancelled && requestId === latestRequestId) {
          setOrders(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        console.error('[unlock-orders] Failed to refresh unlock orders', err);
        if (!cancelled && requestId === latestRequestId) {
          setError('Unable to refresh unlock orders right now.');
          setLoading(false);
        }
      } finally {
        if (requestId === latestRequestId) {
          inFlight = false;
        }
        if (!cancelled && attempts >= MAX_UNLOCK_ORDERS_POLL_ATTEMPTS) {
          stopPolling();
          setPollingPaused(true);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    void refresh();
    interval = setInterval(refresh, UNLOCK_ORDERS_POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      cancelled = true;
      unmountController.abort();
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [merchantSlug, pollGeneration]);

  const restartPolling = () => {
    setError(null);
    setPollingPaused(false);
    setLoading(orders.length === 0);
    setPollGeneration((current) => current + 1);
  };

  return {
    error,
    loading,
    orders,
    pollingPaused,
    restartPolling,
  };
}
