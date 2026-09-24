import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { getFeatureFlagValue } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { useQuizMobileAdsPrewarm } from './use-quiz-mobile-ads-prewarm';

jest.mock('@/services/analytics-core', () => ({
  getFeatureFlagValue: jest.fn(),
}));
jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(async () => ({ canRequestAds: true })),
}));

describe('useQuizMobileAdsPrewarm', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('initializes ads before timed gameplay starts', async () => {
    jest.mocked(getFeatureFlagValue).mockResolvedValue(true);

    renderHook(() => useQuizMobileAdsPrewarm(true));

    await waitFor(() =>
      expect(jest.mocked(initializeQuizMobileAds)).toHaveBeenCalled()
    );
    expect(getFeatureFlagValue).toHaveBeenCalledWith('quiz-mobile-ads');
  });

  it('honors the runtime kill switch before initializing', async () => {
    jest.mocked(getFeatureFlagValue).mockResolvedValue(false);

    renderHook(() => useQuizMobileAdsPrewarm(true));

    await waitFor(() =>
      expect(jest.mocked(getFeatureFlagValue)).toHaveBeenCalled()
    );
    expect(jest.mocked(initializeQuizMobileAds)).not.toHaveBeenCalled();
  });

  it('stays idle when ads are disabled', () => {
    renderHook(() => useQuizMobileAdsPrewarm(false));

    expect(jest.mocked(getFeatureFlagValue)).not.toHaveBeenCalled();
    expect(jest.mocked(initializeQuizMobileAds)).not.toHaveBeenCalled();
  });
});
