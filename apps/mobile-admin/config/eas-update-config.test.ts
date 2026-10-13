import {
  buildEasUpdateConfig,
  createExpoDevClientPlugin,
  EAS_PROJECT_ID,
  EAS_UPDATE_URL,
} from './eas-update-config';

describe('buildEasUpdateConfig', () => {
  it('emits the resolved app version as the bare-workflow runtime version', () => {
    const config = buildEasUpdateConfig({ APP_VERSION: '2.0.42' });

    expect(config.easProjectId).toBe(EAS_PROJECT_ID);
    expect(config.runtimeVersion).toBe('2.0.42');
    expect(config.updates).toMatchObject({
      checkAutomatically: 'ON_LOAD',
      enableBsdiffPatchSupport: true,
      enabled: true,
      fallbackToCacheTimeout: 0,
      url: EAS_UPDATE_URL,
      useEmbeddedUpdate: true,
      requestHeaders: {
        'expo-channel-name': 'production',
      },
    });
  });

  it('uses the shared app-version fallback when no release version is configured', () => {
    expect(buildEasUpdateConfig({}).runtimeVersion).toBe('2.0.1');
  });

  it('embeds an explicit preview channel override', () => {
    const config = buildEasUpdateConfig({
      EXPO_UPDATE_CHANNEL: 'preview',
    });

    expect(config.updates.requestHeaders).toEqual({
      'expo-channel-name': 'preview',
    });
  });

  it('disables OTA checks for development clients', () => {
    const config = buildEasUpdateConfig({
      EAS_BUILD_PROFILE: 'development',
    });

    expect(config.updates).toEqual({ enabled: false });
  });
});

describe('createExpoDevClientPlugin', () => {
  it('launches the most recently opened project without a hardcoded URL', () => {
    expect(createExpoDevClientPlugin()).toEqual([
      'expo-dev-client',
      { launchMode: 'most-recent' },
    ]);
  });
});
