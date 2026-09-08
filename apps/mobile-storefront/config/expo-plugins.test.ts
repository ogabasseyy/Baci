import type { TikTokBusinessPlugin } from '@baci/tiktok-business';
import type { ExpoConfig } from 'expo/config';
import { createExpoPlugins } from './expo-plugins';

describe('createExpoPlugins', () => {
  it('builds iOS Expo consumers from source to prevent the build575 JSI ABI mismatch', () => {
    const plugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });
    const buildProperties = plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildProperties).toEqual([
      'expo-build-properties',
      expect.objectContaining({
        ios: expect.objectContaining({ usePrecompiledModules: false }),
      }),
    ]);
  });

  it('builds Android React Native from source so the native focus fix reaches the APK', () => {
    const plugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });
    const buildProperties = plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildProperties).toEqual([
      'expo-build-properties',
      expect.objectContaining({
        android: expect.objectContaining({ buildReactNativeFromSource: true }),
      }),
    ]);
  });

  it('configures minification, resource shrinking, and class repackaging for Android release builds', () => {
    const plugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });
    const buildPropertiesPlugin = plugins.find(
      (plugin): plugin is [string, Record<string, unknown>] =>
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildPropertiesPlugin?.[1]).toMatchObject({
      android: {
        enableMinifyInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        useLegacyPackaging: true,
        extraProguardRules: expect.stringContaining('-repackageclasses'),
      },
    });
    expect(buildPropertiesPlugin?.[1]).toMatchObject({
      android: {
        extraProguardRules: expect.stringContaining(
          '-keep class com.google.android.gms.internal.consent_sdk.** { *; }'
        ),
      },
    });
    expect(plugins).toContain('expo-audio');
  });

  it('includes supplied conditional plugins and omits them when unconfigured', () => {
    const facebookSdkPlugin: NonNullable<ExpoConfig['plugins']>[number] = [
      'react-native-fbsdk-next',
      { appID: '123456789' },
    ];
    const tiktokBusinessPlugin: TikTokBusinessPlugin = [
      '@baci/tiktok-business/plugin',
      {
        ios: {
          appId: '6472735367',
          appSecret: 'secret',
          autoInitialize: false,
          tiktokAppId: '7644050881196883975',
        },
      },
    ];
    const sentryPlugin: NonNullable<ExpoConfig['plugins']>[number] = [
      '@sentry/react-native/expo',
      { useNativeInit: true },
    ];

    const configuredPlugins = createExpoPlugins({
      facebookSdkPlugin,
      sentryPlugin,
      tiktokBusinessPlugin,
    });

    expect(configuredPlugins).toEqual(
      expect.arrayContaining([
        facebookSdkPlugin,
        sentryPlugin,
        tiktokBusinessPlugin,
      ])
    );

    const unconfiguredPlugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });
    expect(unconfiguredPlugins).not.toContain(null);
    expect(
      unconfiguredPlugins.some(
        (plugin) =>
          Array.isArray(plugin) && plugin[0] === 'react-native-fbsdk-next'
      )
    ).toBe(false);
    expect(
      unconfiguredPlugins.some(
        (plugin) =>
          Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo'
      )
    ).toBe(false);
    expect(
      unconfiguredPlugins.some(
        (plugin) =>
          Array.isArray(plugin) && plugin[0] === '@baci/tiktok-business/plugin'
      )
    ).toBe(false);
  });
});
