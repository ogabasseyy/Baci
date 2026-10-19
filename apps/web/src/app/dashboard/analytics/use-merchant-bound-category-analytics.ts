'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';
import { fetchAnalyticsCategoryData } from './fetch-analytics-category-data';

interface UseMerchantBoundCategoryAnalyticsOptions {
  allowed: boolean;
  category: AnalyticsCategory;
  from: Date | undefined;
  merchantId: string | undefined;
  refreshKey: number;
  to: Date | undefined;
}

interface CategoryAnalyticsSnapshot {
  data: Partial<AnalyticsData>;
  requestKey: string;
}

function buildRequestKey({
  category,
  from,
  merchantId,
  to,
}: Pick<
  UseMerchantBoundCategoryAnalyticsOptions,
  'category' | 'from' | 'merchantId' | 'to'
>): string | null {
  if (!merchantId || !from || !to) return null;
  return `${category}:${merchantId}:${from.toISOString()}:${to.toISOString()}`;
}

export function useMerchantBoundCategoryAnalytics({
  allowed,
  category,
  from,
  merchantId,
  refreshKey,
  to,
}: UseMerchantBoundCategoryAnalyticsOptions) {
  const requestKey = buildRequestKey({ category, from, merchantId, to });
  const requestKeyRef = useRef<string | null>(requestKey);
  requestKeyRef.current = requestKey;
  const [snapshot, setSnapshot] = useState<CategoryAnalyticsSnapshot | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [errorRequestKey, setErrorRequestKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSpecialized = ['ads', 'inventory', 'segments'].includes(category);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    setErrorRequestKey(null);
    setLoading(isSpecialized);

    if (!allowed || !requestKey || !merchantId || !from || !to) {
      setLoading(false);
      return () => controller.abort();
    }
    const requestKeyAtStart = requestKey;

    fetchAnalyticsCategoryData({
      category,
      from,
      merchantId,
      refreshKey: refreshKey > 0 ? refreshKey : undefined,
      signal: controller.signal,
      to,
    })
      .then((categoryData) => {
        if (
          !controller.signal.aborted &&
          requestKeyRef.current === requestKeyAtStart
        ) {
          setSnapshot({ data: categoryData, requestKey: requestKeyAtStart });
        }
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return;
        }
        console.error('Error fetching category analytics:', fetchError);
        if (
          !controller.signal.aborted &&
          requestKeyRef.current === requestKeyAtStart
        ) {
          setSnapshot(null);
          setError(`Unable to load ${category} analytics. Please try again.`);
          setErrorRequestKey(requestKeyAtStart);
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestKeyRef.current === requestKeyAtStart
        ) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    allowed,
    category,
    from,
    isSpecialized,
    merchantId,
    refreshKey,
    requestKey,
    to,
  ]);

  const isCurrent = snapshot?.requestKey === requestKey;
  const hasCurrentError = errorRequestKey === requestKey;
  return {
    data: isCurrent ? snapshot.data : null,
    error: hasCurrentError ? error : null,
    loading,
  };
}
