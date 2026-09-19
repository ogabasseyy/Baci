import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

const mockUnlockBadge = jest.fn();
const mockUseQuizMobileAds = jest.fn();
const mockAuthCustomer = { date_of_birth: null as string | null };

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
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ customer: mockAuthCustomer }),
}));
jest.mock('@/stores/quiz-badge-store', () => ({
  useQuizBadgeStore: (selector: (state: unknown) => unknown) =>
    selector({ getBadge: () => null, unlockBadge: mockUnlockBadge }),
}));

const mockSetQuizRewardedFlowActive = jest.fn();
jest.mock('@/lib/quiz-start-interstitial', () => ({
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

import {
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import { useQuizRewardedBadge } from './use-quiz-rewarded-badge';

type GateProps = {
  eventId: string;
  eventTitle: string;
  remainingSeconds: number;
  status: 'active' | 'scheduled';
  userId: string;
};

describe('useQuizRewardedBadge', () => {
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

  it('offers only while more than 90 seconds remain in a scheduled room', () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useQuizRewardedBadge>,
      GateProps
    >(
      ({ eventId, eventTitle, remainingSeconds, status, userId }: GateProps) =>
        useQuizRewardedBadge({
          eventId,
          eventTitle,
          remainingSeconds,
          status,
          userId,
        }),
      {
        initialProps: {
          eventId: 'event-1',
          eventTitle: 'Today Quiz',
          remainingSeconds: 91,
          status: 'scheduled',
          userId: 'user-1',
        },
      }
    );

    expect(result.current.available).toBe(true);
    rerender({
      eventId: 'event-1',
      eventTitle: 'Today Quiz',
      remainingSeconds: 90,
      status: 'scheduled',
      userId: 'user-1',
    });
    expect(result.current.available).toBe(false);
    rerender({
      eventId: 'event-1',
      eventTitle: 'Today Quiz',
      remainingSeconds: 120,
      status: 'active',
      userId: 'user-1',
    });
    expect(result.current.available).toBe(false);
  });

  it('does not request or initialize ads while the shopper is unauthenticated', () => {
    mockUseQuizMobileAds.mockClear();
    const { result } = renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: null,
      })
    );

    expect(result.current.available).toBe(false);
    expect(mockUseQuizMobileAds).toHaveBeenCalledWith(
      expect.objectContaining({ requested: false })
    );
  });

  it('passes the verified adult status into rewarded-ad initialization', () => {
    mockAuthCustomer.date_of_birth = '2000-01-01';

    renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: 'user-1',
      })
    );

    expect(mockUseQuizMobileAds).toHaveBeenCalledWith(
      expect.objectContaining({ ageVerified: true })
    );
  });

  it('grants only when the ad emits EARNED_REWARD', () => {
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
    expect(mockUnlockBadge).not.toHaveBeenCalled();
    act(() => listeners.get('closed')?.());
    expect(mockUnlockBadge).not.toHaveBeenCalled();

    act(() => result.current.watchAd());
    act(() =>
      listeners.get(RewardedAdEventType.EARNED_REWARD)?.({ amount: 1 })
    );
    expect(mockUnlockBadge).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      'Today Quiz'
    );
    expect(result.current.justEarned).toBe(true);
    expect(result.current.available).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.justEarned).toBe(false);
    expect(result.current.available).toBe(false);
  });

  it('does not block the room when the user dismisses the offer', () => {
    const { result } = renderHook(() =>
      useQuizRewardedBadge({
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        remainingSeconds: 120,
        status: 'scheduled',
        userId: 'user-1',
      })
    );

    act(() => result.current.dismiss());
    expect(result.current.available).toBe(false);
    expect(result.current.roomBlocked).toBe(false);
  });

  it('flags a retryable failure when the ad errors', () => {
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
    act(() => listeners.get('error')?.());
    expect(result.current.watchFailed).toBe(true);
    expect(result.current.isWatching).toBe(false);
    expect(mockUnlockBadge).not.toHaveBeenCalled();
    act(() => result.current.watchAd());
    expect(result.current.watchFailed).toBe(false);
    expect(result.current.isWatching).toBe(true);
  });

  it('claims and releases interstitial ownership around the rewarded flow', () => {
    // Regression: the interstitial must defer while the rewarded ad is
    // loading or presented so the two full-screen placements never race.
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
    act(() => listeners.get('closed')?.());
    expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(false);
    expect(result.current.isWatching).toBe(false);
  });

  it('holds fullscreen ownership after EARNED_REWARD until the ad closes', () => {
    // Regression: the reward fires while the ad is still on screen, so
    // releasing here lets a quiz-start interstitial present over it.
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
    act(() =>
      listeners.get(RewardedAdEventType.EARNED_REWARD)?.({ amount: 1 })
    );
    expect(mockUnlockBadge).toHaveBeenCalledTimes(1);
    expect(result.current.justEarned).toBe(true);
    expect(result.current.isWatching).toBe(true);
    expect(mockSetQuizRewardedFlowActive).not.toHaveBeenCalledWith(false);
    act(() => listeners.get('closed')?.());
    expect(mockSetQuizRewardedFlowActive).toHaveBeenCalledWith(false);
    expect(result.current.isWatching).toBe(false);
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

  it('does not show a rewarded ad if it finishes loading after dismissal', () => {
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
    act(() => result.current.dismiss());
    act(() => listeners.get(RewardedAdEventType.LOADED)?.());

    expect(mockAd.show).not.toHaveBeenCalled();
    expect(result.current.isWatching).toBe(false);
  });
});
