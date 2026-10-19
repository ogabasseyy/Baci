import type { Dispatch, SetStateAction } from 'react';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';

const BASE_ANALYTICS_ERROR = 'Unable to load analytics. Please try again.';

export async function fetchBaseAnalytics({
  from,
  merchantId,
  to,
  signal,
  setBaseAnalytics,
  setError,
  setLoadingAnalytics,
}: {
  from: Date;
  merchantId: string;
  to: Date;
  signal: AbortSignal;
  setBaseAnalytics: Dispatch<SetStateAction<AnalyticsData | null>>;
  setError?: Dispatch<SetStateAction<string | null>>;
  setLoadingAnalytics: Dispatch<SetStateAction<boolean>>;
}): Promise<void> {
  setLoadingAnalytics(true);
  setError?.(null);
  try {
    const queryParams = new URLSearchParams({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
    });
    const response = await fetch(`/api/analytics?${queryParams.toString()}`, {
      headers: { 'x-baci-merchant-id': merchantId },
      signal,
    });
    if (!signal.aborted) {
      if (response.ok) {
        const analytics = await response.json();
        if (!signal.aborted) setBaseAnalytics(analytics);
      } else {
        setBaseAnalytics(null);
        setError?.(BASE_ANALYTICS_ERROR);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    if (!signal.aborted) {
      setBaseAnalytics(null);
      setError?.(BASE_ANALYTICS_ERROR);
    }
  } finally {
    if (!signal.aborted) setLoadingAnalytics(false);
  }
}
