'use client';

import { useEffect, useState } from 'react';
import {
  getRecentInteractions,
  getSantaStats,
  type SantaInteraction,
  type SantaStats,
} from './actions';

const SANTA_POLL_INTERVAL_MS = 30_000;
const MAX_SANTA_POLL_ATTEMPTS = 120;

export function useSantaPolling(merchantId: string | undefined) {
  const [stats, setStats] = useState<SantaStats | null>(null);
  const [interactions, setInteractions] = useState<SantaInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollGeneration, setPollGeneration] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollGeneration intentionally restarts the live polling budget on user refresh.
  useEffect(() => {
    if (!merchantId) return;
    const activeMerchantId = merchantId;

    setPollingPaused(false);
    setPollError(null);
    let isStale = false;
    let inFlight = false;
    let latestRequestId = 0;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    function stopPolling() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    function fetchData() {
      if (isStale || inFlight) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (attempts >= MAX_SANTA_POLL_ATTEMPTS) {
        stopPolling();
        if (!isStale) setPollingPaused(true);
        return;
      }

      attempts += 1;
      inFlight = true;
      const requestId = ++latestRequestId;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const underlyingRequest = Promise.all([
        getSantaStats(activeMerchantId),
        getRecentInteractions(activeMerchantId),
      ]);
      // Keep inFlight true until the underlying server actions settle so a
      // timed-out request cannot overlap with a new interval tick.
      void underlyingRequest
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
      Promise.race([
        underlyingRequest,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Santa poll request timed out')),
            15_000
          );
        }),
      ])
        .then(([fetchedStats, fetchedInteractions]) => {
          if (isStale || requestId !== latestRequestId) return;
          setPollError(null);
          setStats(fetchedStats);
          setInteractions(fetchedInteractions);
        })
        .catch((error: unknown) => {
          console.error('Failed to load Santa data', error);
          if (!isStale && requestId === latestRequestId) {
            setPollError('Unable to refresh live campaign stats.');
          }
        })
        .finally(() => {
          if (timeoutId !== null) clearTimeout(timeoutId);
          if (isStale) return;
          setLoading(false);
          if (attempts >= MAX_SANTA_POLL_ATTEMPTS) {
            stopPolling();
            setPollingPaused(true);
          }
        });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }

    fetchData();
    interval = setInterval(fetchData, SANTA_POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      isStale = true;
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      }
    };
  }, [merchantId, pollGeneration]);

  const restartPolling = () => {
    setPollingPaused(false);
    setPollError(null);
    setPollGeneration((current) => current + 1);
  };

  return {
    interactions,
    loading,
    pollError,
    pollingPaused,
    restartPolling,
    stats,
  };
}
