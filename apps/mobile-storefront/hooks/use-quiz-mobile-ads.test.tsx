import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/services/analytics-core', () => ({
  getFeatureFlagValue: jest.fn(),
}));
jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(),
  isQuizMobileAdsAttemptDisabled: jest.fn(() => false),
}));

import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getFeatureFlagValue } from '@/services/analytics-core';
import {
  initializeQuizMobileAds,
  isQuizMobileAdsAttemptDisabled,
} from '@/services/initialize-quiz-mobile-ads';
import { useQuizMobileAds } from './use-quiz-mobile-ads';

const mockGetFeatureFlagValue = jest.mocked(getFeatureFlagValue);
const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);
const mockIsQuizMobileAdsAttemptDisabled = jest.mocked(
  isQuizMobileAdsAttemptDisabled
);
const mockIsQuizMobileAdsAvailable = jest.mocked(isQuizMobileAdsAvailable);

const enabledConfig = {
  bannerUnitId: 'ca-app-pub-3940256099942544/9214589741',
  enabled: true,
} as const;

describe('useQuizMobileAds', () => {
  beforeEach(() => {
    mockGetFeatureFlagValue.mockReset().mockResolvedValue(undefined);
    mockInitializeQuizMobileAds
      .mockReset()
      .mockResolvedValue({ canRequestAds: true });
    mockIsQuizMobileAdsAvailable.mockReset().mockReturnValue(true);
    mockIsQuizMobileAdsAttemptDisabled.mockReset().mockReturnValue(false);
  });

  it('does no ad work when gameplay has not requested the placement', () => {
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: false })
    );

    expect(result.current).toEqual({
      bannerUnitId: null,
      canRequestAds: false,
      enabled: false,
      initialized: false,
    });
    expect(mockGetFeatureFlagValue).not.toHaveBeenCalled();
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('falls back to the build-time setting when the runtime flag is unavailable', async () => {
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        bannerUnitId: enabledConfig.bannerUnitId,
        canRequestAds: true,
        enabled: true,
        initialized: true,
      })
    );
  });

  it('honors the runtime kill switch without initializing the SDK', async () => {
    mockGetFeatureFlagValue.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current).toEqual({
      bannerUnitId: null,
      canRequestAds: false,
      enabled: false,
      initialized: true,
    });
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('skips the gameplay retry when the pre-start attempt failed', async () => {
    mockIsQuizMobileAdsAttemptDisabled.mockReturnValue(true);
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current).toEqual({
      bannerUnitId: null,
      canRequestAds: false,
      enabled: false,
      initialized: true,
    });
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });

  it('keeps the placement inert when consent does not allow ad requests', async () => {
    mockInitializeQuizMobileAds.mockResolvedValue({ canRequestAds: false });
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current).toEqual({
      bannerUnitId: enabledConfig.bannerUnitId,
      canRequestAds: false,
      enabled: true,
      initialized: true,
    });
  });

  it('fails closed without interrupting gameplay when initialization fails', async () => {
    mockInitializeQuizMobileAds.mockRejectedValue(
      new Error('native SDK unavailable')
    );
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current).toEqual({
      bannerUnitId: null,
      canRequestAds: false,
      enabled: false,
      initialized: true,
    });
  });

  it('stays disabled when the build-time configuration is off', () => {
    const { result } = renderHook(() =>
      useQuizMobileAds({ config: { enabled: false }, requested: true })
    );

    expect(result.current.enabled).toBe(false);
    expect(mockGetFeatureFlagValue).not.toHaveBeenCalled();
  });

  it('stays disabled in an older dev client without the native module', () => {
    mockIsQuizMobileAdsAvailable.mockReturnValue(false);

    const { result } = renderHook(() =>
      useQuizMobileAds({ config: enabledConfig, requested: true })
    );

    expect(result.current.enabled).toBe(false);
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
  });
});
