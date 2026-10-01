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

describe('mobile-admin EAS Update foundation', () => {
  it('uses the resolved app version as the runtime and project-bound EAS Update URL', async () => {
    vi.stubEnv('APP_VERSION', '2.0.42');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.version).toBe('2.0.42');
    expect(config.runtimeVersion).toBe('2.0.42');
    expect(config.extra?.eas).toEqual({
      projectId: '4b258ae6-fc8a-4b3d-bcbe-dfb3402203c9',
    });
    expect(config.updates?.url).toBe(
      'https://u.expo.dev/4b258ae6-fc8a-4b3d-bcbe-dfb3402203c9'
    );
  });

  it('keeps update startup conservative and enables Hermes bytecode diffs', async () => {
    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.updates).toMatchObject({
      checkAutomatically: 'ON_LOAD',
      enableBsdiffPatchSupport: true,
      enabled: true,
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
    });
  });

  it('embeds the production update channel for local release prebuilds', async () => {
    vi.stubEnv('EAS_BUILD_PROFILE', '');
    vi.stubEnv('EXPO_PUBLIC_ENV', '');
    vi.stubEnv('EXPO_UPDATE_CHANNEL', '');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.updates?.requestHeaders).toEqual({
      'expo-channel-name': 'production',
    });
  });

  it('honors an explicit preview channel override', async () => {
    vi.stubEnv('EXPO_UPDATE_CHANNEL', 'preview');

    const { default: buildConfig } = await import('./app.config');
    const config = buildConfig(TEST_CONFIG_CONTEXT);

    expect(config.updates?.requestHeaders).toEqual({
      'expo-channel-name': 'preview',
    });
  });
});
