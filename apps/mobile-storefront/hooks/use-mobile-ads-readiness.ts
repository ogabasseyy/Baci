import { useEffect, useState } from 'react';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';

export interface MobileAdsReadiness {
  /** UMP consent resolved and the shopper can be served ads. */
  canRequestAds: boolean;
  /** Consent + SDK initialization settled (either way). */
  initialized: boolean;
}

interface UseMobileAdsReadinessOptions {
  /**
   * Only a locally validated adult DOB may opt out of under-age treatment.
   * Defaults to the protective under-age request configuration.
   */
  ageVerified?: boolean;
  /** Build-time placement gate (e.g. `EXPO_PUBLIC_MOBILE_ADS_ENABLED`). */
  enabled: boolean;
}

const NOT_READY: MobileAdsReadiness = {
  canRequestAds: false,
  initialized: false,
};

/**
 * Shared consent readiness for the general ad placements (banners and
 * interstitials outside the quiz rewarded flow). Gathers UMP consent once,
 * applies the protective under-age request configuration, and initializes
 * the native SDK — mirroring the quiz flow — so no banner or interstitial
 * requests Google ads before consent is gathered. Render nothing until
 * `canRequestAds` is true.
 */
export function useMobileAdsReadiness({
  ageVerified = false,
  enabled,
}: UseMobileAdsReadinessOptions): MobileAdsReadiness {
  const [readiness, setReadiness] = useState<MobileAdsReadiness>(NOT_READY);

  useEffect(() => {
    if (!enabled || !isQuizMobileAdsAvailable()) {
      setReadiness(NOT_READY);
      return;
    }
    setReadiness(NOT_READY);
    const controller = new AbortController();
    void initializeQuizMobileAds(controller.signal, { ageVerified })
      .then((result) => {
        if (!controller.signal.aborted) {
          setReadiness({
            canRequestAds: result.canRequestAds,
            initialized: true,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReadiness({ canRequestAds: false, initialized: true });
        }
      });
    return () => {
      controller.abort();
    };
  }, [ageVerified, enabled]);

  return readiness;
}
