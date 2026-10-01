'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';
import { fetchBaseAnalytics } from './fetch-base-analytics';

interface UseMerchantBoundBaseAnalyticsOptions {
  from: Date | undefined;
  merchantId: string | undefined;
  refreshKey: number;
  to: Date | undefined;
}

interface BaseAnalyticsSnapshot {
  data: AnalyticsData;
  requestKey: string;
}

function buildRequestKey(
  merchantId: string | undefined,
  from: Date | undefined,
  to: Date | undefined
): string | null {
  if (!merchantId || !from || !to) return null;
  return `${merchantId}:${from.toISOString()}:${to.toISOString()}`;
}

export function useMerchantBoundBaseAnalytics({
  from,
  merchantId,
  refreshKey,
  to,
}: UseMerchantBoundBaseAnalyticsOptions) {
  const requestKey = buildRequestKey(merchantId, from, to);
  const requestKeyRef = useRef<string | null>(requestKey);
  requestKeyRef.current = requestKey;
  const [snapshot, setSnapshot] = useState<BaseAnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRequestKey, setErrorRequestKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally triggers a manual reload even though the request body is unchanged.
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setErrorRequestKey(null);
    if (!merchantId || !from || !to || !requestKey) return;

    const controller = new AbortController();
    const requestKeyAtStart = requestKey;
    const setBoundAnalytics: Dispatch<SetStateAction<AnalyticsData | null>> = (
      next
    ) => {
      setSnapshot((current) => {
        if (requestKeyRef.current !== requestKeyAtStart) return current;
        const currentData =
          current?.requestKey === requestKeyAtStart ? current.data : null;
        const analytics = typeof next === 'function' ? next(currentData) : next;
        return analytics
          ? { data: analytics, requestKey: requestKeyAtStart }
          : null;
      });
    };
    const setBoundLoading: Dispatch<SetStateAction<boolean>> = (next) => {
      if (requestKeyRef.current !== requestKeyAtStart) return;
      setLoading(next);
    };
    const setBoundError: Dispatch<SetStateAction<string | null>> = (next) => {
      if (requestKeyRef.current !== requestKeyAtStart) return;
      setError((current) => {
        const nextError = typeof next === 'function' ? next(current) : next;
        setErrorRequestKey(nextError ? requestKeyAtStart : null);
        return nextError;
      });
    };

    fetchBaseAnalytics({
      from,
      merchantId,
      signal: controller.signal,
      to,
      setBaseAnalytics: setBoundAnalytics,
      setError: setBoundError,
      setLoadingAnalytics: setBoundLoading,
    });

    return () => controller.abort();
  }, [from, merchantId, refreshKey, requestKey, to]);

  const isCurrent = snapshot?.requestKey === requestKey;
  const hasCurrentError = errorRequestKey === requestKey;
  return {
    data: isCurrent ? snapshot.data : null,
    error: hasCurrentError ? error : null,
    loading,
  };
}
