import { useEffect } from 'react';
import { getFeatureFlagValue } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';

export function useQuizMobileAdsPrewarm(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const runtimeFlag = await getFeatureFlagValue('quiz-mobile-ads');
      if (!cancelled && runtimeFlag !== false) {
        initializeQuizMobileAds().catch(() => null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
