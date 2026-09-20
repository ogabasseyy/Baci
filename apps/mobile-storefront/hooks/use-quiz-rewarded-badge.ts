import { useEffect, useRef, useState } from 'react';
import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { useQuizMobileAds } from '@/hooks/use-quiz-mobile-ads';
import { setQuizRewardedFlowActive } from '@/lib/quiz-fullscreen-ownership';
import { isAdultDateOfBirth } from '@/schemas/date-of-birth';
import { useAuthStore } from '@/stores/auth-store';
import { useQuizBadgeStore } from '@/stores/quiz-badge-store';
import { isRewardedPlacementEnabled } from './is-rewarded-placement-enabled';
import { useRewardedAppState } from './use-rewarded-app-state';

const MINIMUM_REMAINING_SECONDS = 90;

// Matches the interstitial settlement timers: a load that never resolves
// must not hold fullscreen ownership forever.
const REWARDED_AD_LOAD_TIMEOUT_MS = 30_000;

export interface UseQuizRewardedBadgeOptions {
  eventId: string;
  eventTitle: string;
  remainingSeconds: number;
  status: 'scheduled' | string;
  userId: string | null;
}

export interface QuizRewardedBadgeState {
  available: boolean;
  dismiss: () => void;
  isWatching: boolean;
  justEarned: boolean;
  roomBlocked: false;
  watchAd: () => void;
  watchFailed: boolean;
}

interface RewardedAdInstance {
  addAdEventListener: (
    event: string,
    listener: (payload?: unknown) => void
  ) => () => void;
  load: () => void;
  show: () => Promise<void>;
}

interface MobileAdsModule {
  AdEventType: { CLOSED: string; ERROR: string };
  RewardedAd: {
    createForAdRequest: (unitId: string) => RewardedAdInstance;
  };
  RewardedAdEventType: { EARNED_REWARD: string; LOADED: string };
}

interface RewardedAdSession {
  cleanups: Array<() => void>;
  generation: number;
  identityKey: string;
  presented: boolean;
  settled: boolean;
}

function loadMobileAdsModule(): MobileAdsModule | null {
  try {
    return require('react-native-google-mobile-ads') as MobileAdsModule;
  } catch {
    return null;
  }
}

export function useQuizRewardedBadge({
  eventId,
  eventTitle,
  remainingSeconds,
  status,
  userId,
}: UseQuizRewardedBadgeOptions): QuizRewardedBadgeState {
  const [dismissed, setDismissed] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [watchFailed, setWatchFailed] = useState(false);
  const [justEarned, setJustEarned] = useState(false);
  const identityKey = `${userId ?? ''}:${eventId}`;
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  const sessionRef = useRef<RewardedAdSession | null>(null);
  identityRef.current = identityKey;
  // Background transitions abandon pending loads (see module); the ref
  // lets presentation guards read app state without rerendering.
  const appStateRef = useRewardedAppState(sessionRef, () => {
    setIsWatching(false);
  });
  const dateOfBirth = useAuthStore((state) => state.customer?.date_of_birth);
  const config = getQuizMobileAdsConfig();
  const adState = useQuizMobileAds({
    ageVerified: isAdultDateOfBirth(dateOfBirth),
    config,
    requested:
      Boolean(userId) &&
      status === 'scheduled' &&
      remainingSeconds > MINIMUM_REMAINING_SECONDS,
  });
  const unlockBadge = useQuizBadgeStore((state) => state.unlockBadge);
  const isUnlocked = useQuizBadgeStore((state) =>
    userId ? Boolean(state.getBadge(userId, eventId)) : false
  );
  const isEligible =
    status === 'scheduled' &&
    remainingSeconds > MINIMUM_REMAINING_SECONDS &&
    Boolean(userId);
  // The earned confirmation outlives eligibility: once the reward lands the
  // shopper keeps seeing it even as the countdown runs under 90 seconds.
  // The global placement gate governs REWARDED too (see module).
  const available =
    isRewardedPlacementEnabled() &&
    (justEarned ||
      (isEligible &&
        !dismissed &&
        !isUnlocked &&
        adState.enabled &&
        adState.initialized &&
        adState.canRequestAds &&
        Boolean(adState.rewardedUnitId)));

  // The composite identity intentionally owns the ad session lifetime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: account/event identity is the session boundary
  useEffect(() => {
    generationRef.current += 1;
    setDismissed(false);
    setIsWatching(false);
    setWatchFailed(false);
    setJustEarned(false);
    setQuizRewardedFlowActive(false);
    return () => {
      generationRef.current += 1;
      setQuizRewardedFlowActive(false);
      const session = sessionRef.current;
      if (!session) return;
      session.settled = true;
      session.cleanups.forEach((unsubscribe) => {
        unsubscribe();
      });
      session.cleanups = [];
      sessionRef.current = null;
    };
  }, [identityKey]);

  useEffect(() => {
    const session = sessionRef.current;
    // A presented ad owns its reward: the countdown crossing 90 seconds
    // mid-watch must not swallow the earned badge.
    if (isEligible || !session || session.presented) return;
    session.settled = true;
    session.cleanups.forEach((unsubscribe) => {
      unsubscribe();
    });
    session.cleanups = [];
    sessionRef.current = null;
    // Release rewarded ownership like finish/dismiss: without this, a
    // concurrently loading quiz-start interstitial stays skipped even though
    // the rewarded flow no longer exists.
    setQuizRewardedFlowActive(false);
    setIsWatching(false);
  }, [isEligible]);

  const dismiss = () => {
    const session = sessionRef.current;
    if (session) {
      session.settled = true;
      session.cleanups.forEach((unsubscribe) => {
        unsubscribe();
      });
      session.cleanups = [];
      sessionRef.current = null;
    }
    setQuizRewardedFlowActive(false);
    setIsWatching(false);
    setWatchFailed(false);
    setJustEarned(false);
    setDismissed(true);
  };

  const watchAd = () => {
    if (!available || !userId || !adState.rewardedUnitId || isWatching) return;
    const mobileAds = loadMobileAdsModule();
    if (!mobileAds) {
      // Native ads module missing (e.g. Expo Go): say so instead of a dead tap.
      setWatchFailed(true);
      return;
    }

    setWatchFailed(false);
    setIsWatching(true);
    // Claim full-screen ownership synchronously so an interstitial LOADED
    // event landing before the rerender still defers to the rewarded ad.
    setQuizRewardedFlowActive(true);
    const session: RewardedAdSession = {
      cleanups: [],
      generation: generationRef.current,
      identityKey,
      presented: false,
      settled: false,
    };
    sessionRef.current = session;
    const cleanup = () => {
      session.cleanups.forEach((unsubscribe) => {
        unsubscribe();
      });
      session.cleanups = [];
    };
    const finish = () => {
      cleanup();
      if (sessionRef.current === session) sessionRef.current = null;
      setQuizRewardedFlowActive(false);
      setIsWatching(false);
    };
    const isCurrent = () =>
      sessionRef.current === session &&
      !session.settled &&
      session.generation === generationRef.current &&
      session.identityKey === identityRef.current &&
      appStateRef.current !== 'background' &&
      appStateRef.current !== 'inactive';

    try {
      const rewardedAd = mobileAds.RewardedAd.createForAdRequest(
        adState.rewardedUnitId
      );
      session.cleanups = [
        rewardedAd.addAdEventListener(
          mobileAds.RewardedAdEventType.LOADED,
          () => {
            if (!isCurrent()) return;
            session.presented = true;
            void rewardedAd.show().catch(() => {
              if (isCurrent()) setWatchFailed(true);
              finish();
            });
          }
        ),
        rewardedAd.addAdEventListener(
          mobileAds.RewardedAdEventType.EARNED_REWARD,
          () => {
            if (!isCurrent()) return;
            session.settled = true;
            unlockBadge(userId, eventId, eventTitle);
            setJustEarned(true);
            // The ad can still be on screen: keep fullscreen ownership and
            // the CLOSED listener until dismissal, otherwise an interstitial
            // whose load completes in this interval presents over the
            // rewarded ad.
          }
        ),
        rewardedAd.addAdEventListener(mobileAds.AdEventType.CLOSED, () => {
          // CLOSED releases ownership even after EARNED_REWARD settled the
          // session (isCurrent() would exclude it), so match the session
          // by identity instead.
          if (sessionRef.current !== session) {
            cleanup();
            return;
          }
          finish();
        }),
        rewardedAd.addAdEventListener(mobileAds.AdEventType.ERROR, () => {
          if (!isCurrent()) return;
          setWatchFailed(true);
          finish();
        }),
      ];
      rewardedAd.load();
      const loadTimeout = setTimeout(() => {
        // A hung load (neither LOADED nor ERROR) must fail like an SDK
        // error: the offer shows its retry state and fullscreen ownership
        // releases so the interstitial path unblocks. Presented ads are
        // owned by their CLOSED/EARNED_REWARD handlers instead.
        if (!isCurrent() || session.presented) return;
        setWatchFailed(true);
        finish();
      }, REWARDED_AD_LOAD_TIMEOUT_MS);
      session.cleanups.push(() => clearTimeout(loadTimeout));
    } catch {
      // Synchronous setup failures (e.g. uninitialized native SDK) must
      // surface the same failure state as async ERROR / show() rejections,
      // otherwise the tap looks like a dead button on the unchanged offer.
      if (isCurrent()) setWatchFailed(true);
      finish();
    }
  };

  return {
    available,
    dismiss,
    isWatching,
    justEarned,
    roomBlocked: false,
    watchAd,
    watchFailed,
  };
}
