import { useEffect } from 'react';
import { ensureQuizMobileAdsReady } from '@/services/initialize-quiz-mobile-ads';

export function useQuizMobileAdsPrewarm(enabled: boolean): void {
  useEffect(() => {
    if (enabled) void ensureQuizMobileAdsReady();
  }, [enabled]);
}
