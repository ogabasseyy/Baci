import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { ensureQuizMobileAdsReady } from '@/services/initialize-quiz-mobile-ads';
import { useQuizMobileAdsPrewarm } from './use-quiz-mobile-ads-prewarm';

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  ensureQuizMobileAdsReady: jest.fn(async () => undefined),
}));

describe('useQuizMobileAdsPrewarm', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prepares ads before timed gameplay starts', async () => {
    renderHook(() => useQuizMobileAdsPrewarm(true));

    await waitFor(() =>
      expect(jest.mocked(ensureQuizMobileAdsReady)).toHaveBeenCalled()
    );
  });

  it('stays idle when ads are disabled', () => {
    renderHook(() => useQuizMobileAdsPrewarm(false));

    expect(jest.mocked(ensureQuizMobileAdsReady)).not.toHaveBeenCalled();
  });
});
