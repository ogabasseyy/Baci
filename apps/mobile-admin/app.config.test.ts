import type { ConfigContext } from 'expo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('tsx/cjs', () => ({}));

const TEST_CONFIG_CONTEXT = {
  config: {},
  packageJsonPath: '/tmp/package.json',
  projectRoot: '/tmp/mobile-admin',
  staticConfigPath: '/tmp/app.config.ts',
} satisfies ConfigContext;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('mobile-admin app config PostHog wiring', () => {
  it('exposes PostHog env values and enables the Expo source-map plugin', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_API_KEY', 'ph_admin');
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.extra).toMatchObject({
      posthogApiKey: 'ph_admin',
      posthogHost: 'https://eu.i.posthog.com',
    });
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        [
          'posthog-react-native/expo',
          {
            skipOnConflict: true,
            uploadNativeSymbols: true,
          },
        ],
      ])
    );
  });

  it('defaults to the EU ingest host when no host override is provided', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_API_KEY', 'ph_admin');
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', '');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.extra).toMatchObject({
      posthogApiKey: 'ph_admin',
      posthogHost: 'https://eu.i.posthog.com',
    });
  });
});

describe('mobile-admin React Compiler configuration', () => {
  it('enables the SDK 57 React Compiler experiment', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.experiments?.reactCompiler).toBe(true);
  });
});

describe('mobile-admin development client launcher config', () => {
  it('launches the most recently opened project without a hardcoded server URL', async () => {
    vi.stubEnv('EAS_BUILD_PROFILE', 'development');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);
    const devClientPlugin = config.plugins?.find(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-dev-client'
    );

    expect(devClientPlugin).toEqual([
      'expo-dev-client',
      expect.objectContaining({ launchMode: 'most-recent' }),
    ]);
    expect(devClientPlugin).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ defaultLaunchURL: expect.anything() }),
      ])
    );
  });

  it('does not inject a development server URL into production config', async () => {
    vi.stubEnv('EAS_BUILD_PROFILE', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://192.0.2.10:8081');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);
    const devClientPlugin = config.plugins?.find(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-dev-client'
    );

    expect(devClientPlugin).toEqual([
      'expo-dev-client',
      expect.objectContaining({ launchMode: 'most-recent' }),
    ]);
    expect(JSON.stringify(devClientPlugin)).not.toContain('192.0.2.10');
    expect(JSON.stringify(devClientPlugin)).not.toContain('defaultLaunchURL');
  });
});

describe('mobile-admin app config version resolution', () => {
  it('uses APP_VERSION as the versionName (Android release auto-increment)', async () => {
    vi.stubEnv('APP_VERSION', '2.0.640');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.640');
  });

  it('falls back to IOS_APP_VERSION when APP_VERSION is unset (iOS back-compat)', async () => {
    vi.stubEnv('IOS_APP_VERSION', '2.0.364');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.364');
  });

  it('treats an empty APP_VERSION as unset and still falls back to IOS_APP_VERSION', async () => {
    vi.stubEnv('APP_VERSION', '');
    vi.stubEnv('IOS_APP_VERSION', '2.0.364');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.364');
  });

  it('prefers APP_VERSION over IOS_APP_VERSION', async () => {
    vi.stubEnv('APP_VERSION', '2.0.640');
    vi.stubEnv('IOS_APP_VERSION', '2.0.364');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.640');
  });

  it('falls back to the pinned baseline when no version env is set', async () => {
    vi.stubEnv('APP_VERSION', '');
    vi.stubEnv('IOS_APP_VERSION', '');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.1');
  });

  it('rejects a non-semver app version at load time', async () => {
    vi.stubEnv('APP_VERSION', '2.0');

    await expect(import('./app.config')).rejects.toThrow(/Invalid app version/);
  });
});

describe('mobile-admin Android release optimization config', () => {
  it('blocks the unused advertising ID permission added by expo-tracking-transparency', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.android?.blockedPermissions).toContain(
      'com.google.android.gms.permission.AD_ID'
    );
  });

  it('enables R8 code minification and resource shrinking during prebuild', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.plugins).toEqual(
      expect.arrayContaining([
        [
          'expo-build-properties',
          expect.objectContaining({
            android: expect.objectContaining({
              enableMinifyInReleaseBuilds: true,
              enableShrinkResourcesInReleaseBuilds: true,
            }),
          }),
        ],
      ])
    );
  });
});

describe('mobile-admin Supabase auth config', () => {
  it('exposes the publishable key and keeps a one-release anon fallback', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://abc123.supabase.co');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon-key');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.extra).toMatchObject({
      supabaseAnonKey: 'legacy-anon-key',
      supabasePublishableKey: 'sb_publishable_test',
      supabaseUrl: 'https://abc123.supabase.co',
    });
  });

  it('maps the legacy anon key into the publishable key extra during fallback', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://abc123.supabase.co');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon-key');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.extra).toMatchObject({
      supabasePublishableKey: 'legacy-anon-key',
      supabaseUrl: 'https://abc123.supabase.co',
    });
  });

  it('configures expo-secure-store explicitly for auth key material', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.plugins).toEqual(
      expect.arrayContaining([
        [
          'expo-secure-store',
          {
            configureAndroidBackup: true,
            faceIDPermission:
              'Allow Baci Admin to protect your merchant account credentials.',
          },
        ],
      ])
    );
  });
});

describe('mobile-admin App Tracking Transparency config', () => {
  // Regression: App Store review rejected the app under Guideline 5.1.2(i)
  // because the ATT prompt never appeared. Without this Info.plist key iOS
  // auto-denies requestTrackingPermissionsAsync WITHOUT showing the dialog,
  // silently recreating the rejection.
  it('keeps a non-empty NSUserTrackingUsageDescription in the iOS infoPlist', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    const usageDescription =
      config.ios?.infoPlist?.NSUserTrackingUsageDescription;
    expect(typeof usageDescription).toBe('string');
    expect((usageDescription as string).trim().length).toBeGreaterThan(0);
  });
});
