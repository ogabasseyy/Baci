import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { getFeatureFlagValue } from '@/services/analytics-core';
import { initializeQuizMobileAds } from './initialize-quiz-mobile-ads';
import { prepareQuizMobileAds } from './prepare-quiz-mobile-ads';

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(),
}));
jest.mock('@/config/quiz-mobile-ads', () => ({
  getQuizMobileAdsConfig: jest.fn(),
}));
jest.mock('@/services/analytics-core', () => ({
  getFeatureFlagValue: jest.fn(),
}));
jest.mock('./initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(),
}));

const mockIsQuizMobileAdsAvailable = jest.mocked(isQuizMobileAdsAvailable);
const mockGetQuizMobileAdsConfig = jest.mocked(getQuizMobileAdsConfig);
const mockGetFeatureFlagValue = jest.mocked(getFeatureFlagValue);
const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);

describe('prepareQuizMobileAds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuizMobileAdsConfig.mockReturnValue({
      bannerUnitId: 'ca-app-pub-1234567890123456/1234567890',
      enabled: true,
    });
    mockIsQuizMobileAdsAvailable.mockReturnValue(true);
    mockGetFeatureFlagValue.mockResolvedValue(undefined);
    mockInitializeQuizMobileAds.mockResolvedValue({ canRequestAds: true });
  });

  it('initializes consent and the native SDK before gameplay', async () => {
    await expect(prepareQuizMobileAds()).resolves.toBe(true);

    expect(mockGetFeatureFlagValue).toHaveBeenCalledWith('quiz-mobile-ads');
    expect(mockInitializeQuizMobileAds).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['build-time configuration is disabled', { enabled: false }, true],
    ['native ads module is unavailable', { enabled: true }, false],
  ])('does no SDK work when %s', async (_label, config, nativeAvailable) => {
    mockGetQuizMobileAdsConfig.mockReturnValue(
      config.enabled
        ? {
            bannerUnitId: 'ca-app-pub-1234567890123456/1234567890',
            enabled: true,
          }
        : { enabled: false }
    );
    mockIsQuizMobileAdsAvailable.mockReturnValue(nativeAvailable);

    await expect(prepareQuizMobileAds()).resolves.toBe(true);

    expect(mockGetFeatureFlagValue).not.toHaveBeenCalled();
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('honors the runtime kill switch before initializing', async () => {
    mockGetFeatureFlagValue.mockResolvedValue(false);

    await expect(prepareQuizMobileAds()).resolves.toBe(true);

    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('does not initialize late when the prewarm signal is aborted during flag lookup', async () => {
    let resolveFlag!: (value: boolean) => void;
    mockGetFeatureFlagValue.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveFlag = resolve;
      })
    );
    const controller = new AbortController();
    const preparation = prepareQuizMobileAds(controller.signal);

    controller.abort();
    resolveFlag(true);

    await expect(preparation).resolves.toBe(false);
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('swallows configuration and SDK errors so the quiz can start', async () => {
    mockGetQuizMobileAdsConfig.mockImplementation(() => {
      throw new Error('invalid production ad configuration');
    });

    await expect(prepareQuizMobileAds()).resolves.toBe(false);

    mockGetQuizMobileAdsConfig.mockReturnValue({
      bannerUnitId: 'ca-app-pub-1234567890123456/1234567890',
      enabled: true,
    });
    mockInitializeQuizMobileAds.mockRejectedValueOnce(
      new Error('native SDK unavailable')
    );

    await expect(prepareQuizMobileAds()).resolves.toBe(false);
  });
});
