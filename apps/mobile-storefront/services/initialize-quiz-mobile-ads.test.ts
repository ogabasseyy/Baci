import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGatherConsent = jest.fn<() => Promise<unknown>>();
const mockGetConsentInfo = jest.fn<() => Promise<{ canRequestAds: boolean }>>();
const mockInitialize = jest.fn<() => Promise<unknown>>();
const mockSetRequestConfiguration = jest.fn<() => Promise<void>>();
const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  AdsConsent: {
    gatherConsent: mockGatherConsent,
    getConsentInfo: mockGetConsentInfo,
  },
  MaxAdContentRating: { T: 'T' },
  default: () => ({
    initialize: mockInitialize,
    setRequestConfiguration: mockSetRequestConfiguration,
  }),
}));

async function loadInitializer() {
  return import('./initialize-quiz-mobile-ads');
}

describe('initializeQuizMobileAds', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGatherConsent.mockReset().mockResolvedValue({});
    mockGetConsentInfo.mockReset().mockResolvedValue({ canRequestAds: true });
    mockInitialize.mockReset().mockResolvedValue({});
    mockSetRequestConfiguration.mockReset().mockResolvedValue(undefined);
    mockWarn.mockReset();
  });

  it('gathers consent before configuring and initializing the SDK', async () => {
    const { initializeQuizMobileAds } = await loadInitializer();

    await expect(
      initializeQuizMobileAds(undefined, { ageVerified: true })
    ).resolves.toEqual({
      canRequestAds: true,
    });

    expect(mockGatherConsent).toHaveBeenCalledTimes(1);
    expect(mockGetConsentInfo).toHaveBeenCalledTimes(1);
    expect(mockSetRequestConfiguration).toHaveBeenCalledWith({
      maxAdContentRating: 'T',
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      testDeviceIdentifiers: ['EMULATOR'],
    });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockGatherConsent.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitialize.mock.invocationCallOrder[0]
    );
  });

  it('keeps the SDK in the protective under-age configuration until age is verified', async () => {
    const { initializeQuizMobileAds } = await loadInitializer();

    await expect(initializeQuizMobileAds()).resolves.toEqual({
      canRequestAds: true,
    });

    expect(mockSetRequestConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: true,
      })
    );
  });

  it('does not initialize when the current consent state blocks ad requests', async () => {
    mockGetConsentInfo.mockResolvedValue({ canRequestAds: false });
    const { initializeQuizMobileAds } = await loadInitializer();

    await expect(initializeQuizMobileAds()).resolves.toEqual({
      canRequestAds: false,
    });

    expect(mockSetRequestConfiguration).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('uses the previous-session consent state when consent refresh fails', async () => {
    mockGatherConsent.mockRejectedValue(new Error('UMP unavailable'));
    const { initializeQuizMobileAds } = await loadInitializer();

    await expect(initializeQuizMobileAds()).resolves.toEqual({
      canRequestAds: true,
    });

    expect(mockGetConsentInfo).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      'Consent refresh unavailable; checking the previous consent state.'
    );
  });

  it('deduplicates concurrent initialization calls for the app process', async () => {
    const { initializeQuizMobileAds } = await loadInitializer();

    const [first, second] = await Promise.all([
      initializeQuizMobileAds(),
      initializeQuizMobileAds(),
    ]);

    expect(first).toEqual({ canRequestAds: true });
    expect(second).toEqual({ canRequestAds: true });
    expect(mockGatherConsent).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('reapplies age-sensitive configuration when the shopper identity changes', async () => {
    const { initializeQuizMobileAds } = await loadInitializer();

    await initializeQuizMobileAds(undefined, { ageVerified: false });
    await initializeQuizMobileAds(undefined, { ageVerified: true });

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockSetRequestConfiguration).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tagForUnderAgeOfConsent: true })
    );
    expect(mockSetRequestConfiguration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tagForUnderAgeOfConsent: false })
    );
  });

  it('serializes overlapping identities in invocation order', async () => {
    let resolveGatherConsent!: (value: unknown) => void;
    mockGatherConsent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGatherConsent = resolve;
        })
    );
    let resolveFirstConsentInfo:
      | ((value: { canRequestAds: boolean }) => void)
      | undefined;
    mockGetConsentInfo
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstConsentInfo = resolve;
          })
      )
      .mockResolvedValueOnce({ canRequestAds: true });
    const { initializeQuizMobileAds } = await loadInitializer();

    const underAgeRequest = initializeQuizMobileAds(undefined, {
      ageVerified: false,
    });
    const verifiedAdultRequest = initializeQuizMobileAds(undefined, {
      ageVerified: true,
    });
    for (let attempt = 0; attempt < 10 && !resolveGatherConsent; attempt++) {
      await Promise.resolve();
    }
    if (!resolveGatherConsent) {
      throw new Error('Consent gathering did not start.');
    }
    resolveGatherConsent({});
    for (let attempt = 0; attempt < 10 && !resolveFirstConsentInfo; attempt++) {
      await Promise.resolve();
    }
    if (!resolveFirstConsentInfo) {
      throw new Error('The first consent lookup did not start.');
    }
    resolveFirstConsentInfo({ canRequestAds: true });
    await Promise.all([underAgeRequest, verifiedAdultRequest]);

    expect(mockSetRequestConfiguration).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tagForUnderAgeOfConsent: true })
    );
    expect(mockSetRequestConfiguration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tagForUnderAgeOfConsent: false })
    );
  });

  it('allows a later quiz to retry after native initialization fails', async () => {
    mockInitialize
      .mockRejectedValueOnce(new Error('native module unavailable'))
      .mockResolvedValueOnce({});
    const { initializeQuizMobileAds } = await loadInitializer();

    await expect(initializeQuizMobileAds()).rejects.toThrow(
      'native module unavailable'
    );
    await expect(initializeQuizMobileAds()).resolves.toEqual({
      canRequestAds: true,
    });

    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });
});
