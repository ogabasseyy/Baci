import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { RewardedAdEventType } from 'react-native-google-mobile-ads';
import {
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

describe('useQuizRewardedBadge fullscreen ownership', () => {
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

  it('withholds the offer while the global placement is disabled', () => {
    // Regression: the legacy quiz gate alone must not keep offering
    // rewarded ads while the REWARDED placement is off.
    mockPlacementState.enabled = false;
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

      expect(result.current.available).toBe(false);
    } finally {
      mockPlacementState.enabled = true;
    }
  });
});
