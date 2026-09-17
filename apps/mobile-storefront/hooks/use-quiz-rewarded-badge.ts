import { useEffect, useRef, useState } from 'react';
import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { useQuizMobileAds } from '@/hooks/use-quiz-mobile-ads';
import { isAdultDateOfBirth } from '@/schemas/date-of-birth';
import { useAuthStore } from '@/stores/auth-store';
import { useQuizBadgeStore } from '@/stores/quiz-badge-store';

const MINIMUM_REMAINING_SECONDS = 90;

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
  const available =
    justEarned ||
    (isEligible &&
      !dismissed &&
      !isUnlocked &&
      adState.enabled &&
      adState.initialized &&
      adState.canRequestAds &&
      Boolean(adState.rewardedUnitId));

  // The composite identity intentionally owns the ad session lifetime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: account/event identity is the session boundary
  useEffect(() => {
    generationRef.current += 1;
    setDismissed(false);
    setIsWatching(false);
    setWatchFailed(false);
    setJustEarned(false);
    return () => {
      generationRef.current += 1;
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
      setIsWatching(false);
    };
    const isCurrent = () =>
      sessionRef.current === session &&
      !session.settled &&
      session.generation === generationRef.current &&
      session.identityKey === identityRef.current;

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
            finish();
          }
        ),
        rewardedAd.addAdEventListener(mobileAds.AdEventType.CLOSED, () => {
          if (isCurrent()) finish();
        }),
        rewardedAd.addAdEventListener(mobileAds.AdEventType.ERROR, () => {
          if (!isCurrent()) return;
          setWatchFailed(true);
          finish();
        }),
      ];
      rewardedAd.load();
    } catch {
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
