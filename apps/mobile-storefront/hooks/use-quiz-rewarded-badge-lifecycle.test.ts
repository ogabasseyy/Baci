import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import {
  type GateProps,
  mockAuthCustomer,
  mockPlacementState,
  mockSetQuizRewardedFlowActive,
  mockUnlockBadge,
  mockUseQuizMobileAds,
} from './use-quiz-rewarded-badge-test-harness';

jest.mock('@/config/quiz-mobile-ads', () => ({
  getQuizMobileAdsConfig: () => ({
    bannerUnitId: 'banner-unit',
    enabled: true,
    rewardedUnitId: 'rewarded-unit',
  }),
}));
jest.mock('@/hooks/use-quiz-mobile-ads', () => ({
  useQuizMobileAds: (input: unknown) => mockUseQuizMobileAds(input),
}));
jest.mock('@/config/mobile-ad-placements', () => ({
  getMobileAdUnitId: () => ({
    enabled: mockPlacementState.enabled,
    format: 'rewarded',
    unitId: 'test-rewarded-unit',
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ customer: mockAuthCustomer }),
}));
jest.mock('@/stores/quiz-badge-store', () => ({
  useQuizBadgeStore: (selector: (state: unknown) => unknown) =>
    selector({ getBadge: () => null, unlockBadge: mockUnlockBadge }),
}));
jest.mock('@/lib/quiz-fullscreen-ownership', () => ({
  setQuizRewardedFlowActive: (active: boolean) =>
    mockSetQuizRewardedFlowActive(active),
}));

const listeners = new Map<string, (payload?: unknown) => void>();
const mockAd = {
  addAdEventListener: jest.fn(
    (event: string, listener: (payload?: unknown) => void) => {
      listeners.set(event, listener);
      return jest.fn();
    }
  ),
  load: jest.fn(),
  show: jest.fn<() => Promise<void>>(),
};

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: { CLOSED: 'closed', ERROR: 'error' },
  RewardedAd: {
    createForAdRequest: jest.fn(() => mockAd),
  },
  RewardedAdEventType: { EARNED_REWARD: 'earned-reward', LOADED: 'loaded' },
}));

import { useQuizRewardedBadge } from './use-quiz-rewarded-badge';

describe('useQuizRewardedBadge load lifecycle', () => {
  beforeEach(() => {
    listeners.clear();
    mockAuthCustomer.date_of_birth = null;
    mockUnlockBadge.mockClear();
    mockSetQuizRewardedFlowActive.mockClear();
    mockAd.show.mockClear();
    mockUseQuizMobileAds.mockReturnValue({
      canRequestAds: true,
      enabled: true,
      initialized: true,
      rewardedUnitId: 'rewarded-unit',
    });
  });

  it('fails the watch when loading stalls past the settlement timeout', () => {
    // Regression: a hung SDK load (neither LOADED nor ERROR) must not hold
    // fullscreen ownership forever. After the 30s settlement timeout the
    // offer shows its retry state and the interstitial path unblocks.
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useQuizRewardedBadge({
          eventId: 'event-1',
          eventTitle: 'Today Quiz',
          remainingSeconds: 120,
          status: 'scheduled',
          userId: 'user-1',
        })
      );

      mockSetQuizRewardedFlowActive.mockClear();
      act(() => result.current.watchAd());
      expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(true);
      act(() => {
        jest.advanceTimersByTime(30_000);
      });
      expect(result.current.watchFailed).toBe(true);
      expect(result.current.isWatching).toBe(false);
      expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases interstitial ownership when eligibility expires mid-load', () => {
    // Regression: starting a rewarded load claims interstitial ownership; if
    // the countdown crosses the threshold before presentation, the expiry
    // cleanup must release ownership so the quiz-start interstitial is not
    // skipped for a flow that no longer exists.
    const { result, rerender } = renderHook(
      (props: GateProps) => useQuizRewardedBadge(props),
      {
        initialProps: {
          eventId: 'event-1',
          eventTitle: 'Today Quiz',
          remainingSeconds: 120,
          status: 'scheduled',
          userId: 'user-1',
        },
      }
    );

    mockSetQuizRewardedFlowActive.mockClear();
    act(() => result.current.watchAd());
    expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(true);
    rerender({
      eventId: 'event-1',
      eventTitle: 'Today Quiz',
      remainingSeconds: 90,
      status: 'scheduled',
      userId: 'user-1',
    });
    expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(false);
    expect(result.current.isWatching).toBe(false);
  });

  it('flags a retryable failure when rewarded setup throws synchronously', () => {
    // Regression: a synchronous createForAdRequest/load throw (e.g.
    // uninitialized native SDK) must surface the failure state instead of
    // silently clearing the loading state on the unchanged offer.
    jest.mocked(RewardedAd.createForAdRequest).mockImplementationOnce(() => {
      throw new Error('native SDK not initialized');
    });
    const { result } = renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: 'user-1',
      })
    );

    expect(result.current.watchFailed).toBe(false);
    act(() => result.current.watchAd());
    expect(result.current.watchFailed).toBe(true);
    expect(result.current.isWatching).toBe(false);
    expect(mockUnlockBadge).not.toHaveBeenCalled();
  });

  it('abandons a pending load when the app backgrounds before presentation', () => {
    // Regression: backgrounding after tapping Watch must not present on
    // resume over whatever the shopper sees; ownership releases silently.
    const { result } = renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: 'user-1',
      })
    );

    act(() => result.current.watchAd());
    expect(result.current.isWatching).toBe(true);
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
    act(() => {
      listener('background');
    });

    expect(result.current.isWatching).toBe(false);
    expect(result.current.watchFailed).toBe(false);
    expect(mockSetQuizRewardedFlowActive).toHaveBeenLastCalledWith(false);
    act(() => listeners.get(RewardedAdEventType.LOADED)?.());
    expect(mockAd.show).not.toHaveBeenCalled();
  });

  it('credits a reward delivered while the app is inactive', () => {
    // Regression: a presented rewarded ad that fires EARNED_REWARD during an
    // inactive transition must still credit the badge; only pre-presentation
    // loads are abandoned on backgrounding.
    mockAd.show.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: 'user-1',
      })
    );

    act(() => result.current.watchAd());
    act(() => listeners.get(RewardedAdEventType.LOADED)?.());
    expect(mockAd.show).toHaveBeenCalledTimes(1);
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
    act(() => {
      listener('inactive');
    });
    act(() =>
      listeners.get(RewardedAdEventType.EARNED_REWARD)?.({ amount: 1 })
    );

    expect(mockUnlockBadge).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      'Today Quiz'
    );
    expect(result.current.justEarned).toBe(true);
  });
});
