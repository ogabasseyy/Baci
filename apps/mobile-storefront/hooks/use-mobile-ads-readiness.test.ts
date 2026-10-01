import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(),
}));

import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { useMobileAdsReadiness } from './use-mobile-ads-readiness';

const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);
const mockIsQuizMobileAdsAvailable = jest.mocked(isQuizMobileAdsAvailable);

describe('useMobileAdsReadiness', () => {
  beforeEach(() => {
    mockInitializeQuizMobileAds
      .mockReset()
      .mockResolvedValue({ canRequestAds: true });
    mockIsQuizMobileAdsAvailable.mockReset().mockReturnValue(true);
  });

  it('does no ad work while the placement is disabled', () => {
    const { result } = renderHook(() =>
      useMobileAdsReadiness({ enabled: false })
    );

    expect(result.current).toEqual({
      canRequestAds: false,
      initialized: false,
    });
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('does no ad work when the native module is unavailable', () => {
    mockIsQuizMobileAdsAvailable.mockReturnValue(false);
    const { result } = renderHook(() =>
      useMobileAdsReadiness({ enabled: true })
    );

    expect(result.current.canRequestAds).toBe(false);
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('reports consent readiness once initialization settles', async () => {
    const { result } = renderHook(() =>
      useMobileAdsReadiness({ enabled: true })
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        canRequestAds: true,
        initialized: true,
      })
    );
  });

  it('stays not-ready when consent is denied', async () => {
    mockInitializeQuizMobileAds.mockResolvedValue({ canRequestAds: false });
    const { result } = renderHook(() =>
      useMobileAdsReadiness({ enabled: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.canRequestAds).toBe(false);
  });

  it('passes the verified-adult hint to SDK initialization', async () => {
    const { result } = renderHook(() =>
      useMobileAdsReadiness({ ageVerified: true, enabled: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(mockInitializeQuizMobileAds).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      { ageVerified: true }
    );
  });
});
