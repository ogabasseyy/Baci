import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSentryExpoConfiguration } from './sentry-expo-config';

const completeEnvironment = {
  EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
  SENTRY_AUTH_TOKEN: 'build-token',
  SENTRY_ORG: 'ogabassey',
  SENTRY_PROJECT: 'storefront',
};

describe('buildSentryExpoConfiguration', () => {
  it('enables native startup and ANR capture when fully configured', () => {
    const result = buildSentryExpoConfiguration(completeEnvironment, {
      required: true,
    });

    expect(result.plugin).toEqual([
      '@sentry/react-native/expo',
      expect.objectContaining({
        experimental_android: {
          enableAndroidGradlePlugin: true,
        },
        organization: 'ogabassey',
        project: 'storefront',
        useNativeInit: true,
        options: expect.objectContaining({
          enableAnrFingerprinting: true,
          enableNativeCrashHandling: true,
          sendDefaultPii: false,
        }),
      }),
    ]);
  });

  it('fails production configuration when symbol uploads are not configured', () => {
    expect(() =>
      buildSentryExpoConfiguration(
        { EXPO_PUBLIC_SENTRY_DSN: completeEnvironment.EXPO_PUBLIC_SENTRY_DSN },
        { required: true }
      )
    ).toThrow(/SENTRY_AUTH_TOKEN/);
  });

  it('disables the plugin for an incomplete local environment', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    expect(
      buildSentryExpoConfiguration({}, { required: false }).plugin
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/disabled/));

    warn.mockRestore();
  });

  it('enables local native capture without a symbol-upload token', () => {
    const result = buildSentryExpoConfiguration(
      {
        EXPO_PUBLIC_SENTRY_DSN: completeEnvironment.EXPO_PUBLIC_SENTRY_DSN,
        SENTRY_ORG: 'ogabassey',
        SENTRY_PROJECT: 'storefront',
      },
      { required: false }
    );

    expect(result.plugin).toEqual([
      '@sentry/react-native/expo',
      expect.objectContaining({
        useNativeInit: true,
        disableAutoUpload: true,
        experimental_android: expect.objectContaining({
          autoUploadNativeSymbols: false,
          autoUploadProguardMapping: false,
        }),
        options: expect.objectContaining({ environment: 'development' }),
      }),
    ]);
  });

  it('keeps generated native Sentry credentials out of git on both platforms', () => {
    const ignoreRules = readFileSync(
      resolve(__dirname, '../.gitignore'),
      'utf8'
    )
      .split('\n')
      .map((rule) => rule.trim());

    expect(ignoreRules).toEqual(
      expect.arrayContaining([
        'android/sentry.properties',
        'ios/sentry.properties',
      ])
    );
  });
});
