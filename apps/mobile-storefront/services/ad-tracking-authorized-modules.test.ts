import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let mockExtra: Record<string, unknown> = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

describe('bugfix: Facebook ATT blocked when TikTok import rejects', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExtra = {
      facebookAppId: 'fb-test',
      facebookClientToken: 'client-test',
      tiktokBusiness: { isConfigured: true },
    };
  });

  it('allows Facebook authorization when TikTok is configured but unavailable', async () => {
    const { hasRequiredAuthorizedAdTrackingModules } = await import(
      './ad-tracking-authorized-modules'
    );

    expect(
      hasRequiredAuthorizedAdTrackingModules({
        AEMReporterIOS: null,
        AppEventsLogger: null,
        FBSettings: {
          initializeSDK: () => undefined,
          setAdvertiserTrackingEnabled: () => undefined,
        },
        TikTokBusiness: null,
      })
    ).toBe(true);
  });

  it('rejects authorization when Facebook is configured but unavailable', async () => {
    const { hasRequiredAuthorizedAdTrackingModules } = await import(
      './ad-tracking-authorized-modules'
    );

    expect(
      hasRequiredAuthorizedAdTrackingModules({
        AEMReporterIOS: null,
        AppEventsLogger: null,
        FBSettings: null,
        TikTokBusiness: null,
      })
    ).toBe(false);
  });
});
