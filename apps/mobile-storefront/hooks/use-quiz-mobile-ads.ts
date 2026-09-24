import { useEffect, useState } from 'react';

import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import type { QuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { getFeatureFlagValue } from '@/services/analytics-core';
import {
  initializeQuizMobileAds,
  isQuizMobileAdsAttemptDisabled,
} from '@/services/initialize-quiz-mobile-ads';

interface UseQuizMobileAdsOptions {
  config: QuizMobileAdsConfig;
  requested: boolean;
}

interface QuizMobileAdsState {
  bannerUnitId: string | null;
  canRequestAds: boolean;
  enabled: boolean;
  initialized: boolean;
}

const DISABLED_STATE: QuizMobileAdsState = {
  bannerUnitId: null,
  canRequestAds: false,
  enabled: false,
  initialized: false,
};

export function useQuizMobileAds({
  config,
  requested,
}: UseQuizMobileAdsOptions): QuizMobileAdsState {
  const bannerUnitId = config.enabled ? config.bannerUnitId : null;
  const [state, setState] = useState<QuizMobileAdsState>(DISABLED_STATE);

  useEffect(() => {
    let active = true;

    if (
      !requested ||
      !config.enabled ||
      !bannerUnitId ||
      !isQuizMobileAdsAvailable()
    ) {
      setState(DISABLED_STATE);
      return () => {
        active = false;
      };
    }

    setState({
      bannerUnitId,
      canRequestAds: false,
      enabled: true,
      initialized: false,
    });

    void (async () => {
      const runtimeFlag = await getFeatureFlagValue('quiz-mobile-ads');
      if (!active) return;

      if (runtimeFlag === false) {
        setState({ ...DISABLED_STATE, initialized: true });
        return;
      }

      if (isQuizMobileAdsAttemptDisabled()) {
        setState({ ...DISABLED_STATE, initialized: true });
        return;
      }

      const result = await initializeQuizMobileAds().catch(() => null);
      if (!active) return;

      if (!result) {
        setState({ ...DISABLED_STATE, initialized: true });
        return;
      }

      setState({
        bannerUnitId,
        canRequestAds: result.canRequestAds,
        enabled: true,
        initialized: true,
      });
    })();

    return () => {
      active = false;
    };
  }, [bannerUnitId, config.enabled, requested]);

  return state;
}
