import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { createExpoPlugins } from '../../config/expo-plugins';

type AppConfig = typeof import('../../app.config').default;

const ROOT = path.resolve(__dirname, '../..');
const EXCLUDED_SOURCE_DIRECTORIES = new Set(['__tests__', 'test-utils']);

function findTypeScriptSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_SOURCE_DIRECTORIES.has(entry.name)) {
        return [];
      }

      return findTypeScriptSourceFiles(entryPath);
    }

    if (
      !/\.(ts|tsx)$/.test(entry.name) ||
      entry.name.includes('.test.') ||
      entry.name.includes('.test-utils.')
    ) {
      return [];
    }

    return [entryPath];
  });
}

function findPlugin(
  plugins: NonNullable<ExpoConfig['plugins']>,
  pluginName: string
) {
  return plugins.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === pluginName
  );
}

describe('Expo compliance', () => {
  it('uses a manual runtime version for bare workflow builds', () => {
    const originalFacebookAppId = process.env.STOREFRONT_FACEBOOK_APP_ID;
    const originalFacebookClientToken =
      process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN;
    const originalPosthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
    const originalSentry = {
      authToken: process.env.SENTRY_AUTH_TOKEN,
      dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    };

    process.env.STOREFRONT_FACEBOOK_APP_ID = '123456789';
    process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN = 'client-token';
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'ph_test';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.invalid/1';
    process.env.SENTRY_AUTH_TOKEN = 'test-auth-token';
    process.env.SENTRY_ORG = 'test-org';
    process.env.SENTRY_PROJECT = 'test-project';

    try {
      let config: ExpoConfig | undefined;

      jest.isolateModules(() => {
        const appConfig = require('../../app.config').default as AppConfig;
        const configContext: ConfigContext = {
          config: {} as ExpoConfig,
          packageJsonPath: '',
          projectRoot: ROOT,
          staticConfigPath: '',
        };

        config = appConfig(configContext);
      });

      if (!config) {
        throw new Error('Expected app config to render');
      }

      expect(typeof config.runtimeVersion).toBe('string');
      expect(config.runtimeVersion).toBe(config.version);
    } finally {
      if (originalFacebookAppId === undefined) {
        delete process.env.STOREFRONT_FACEBOOK_APP_ID;
      } else {
        process.env.STOREFRONT_FACEBOOK_APP_ID = originalFacebookAppId;
      }

      if (originalFacebookClientToken === undefined) {
        delete process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN;
      } else {
        process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN =
          originalFacebookClientToken;
      }

      if (originalPosthogApiKey === undefined) {
        delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
      } else {
        process.env.EXPO_PUBLIC_POSTHOG_API_KEY = originalPosthogApiKey;
      }

      for (const [name, value] of Object.entries({
        EXPO_PUBLIC_SENTRY_DSN: originalSentry.dsn,
        SENTRY_AUTH_TOKEN: originalSentry.authToken,
        SENTRY_ORG: originalSentry.org,
        SENTRY_PROJECT: originalSentry.project,
      })) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('app.config.ts does not contain an explicit newArchEnabled override', () => {
    const configSource = readFileSync(
      path.join(ROOT, 'app.config.ts'),
      'utf-8'
    );
    expect(configSource).not.toContain('newArchEnabled');
  });

  it('loads nested app config helpers when Node type stripping is disabled', () => {
    const configSource = readFileSync(
      path.join(ROOT, 'app.config.ts'),
      'utf-8'
    );
    const helperPaths = [
      ...configSource.matchAll(
        /require\('(\.\/config\/(?:expo-plugins|resolve-update-channel)[^']*)'\)/g
      ),
    ].map((match) => match[1]);

    expect(helperPaths).toHaveLength(2);

    const result = spawnSync(
      process.execPath,
      [
        '--no-experimental-strip-types',
        '-e',
        `for (const helperPath of ${JSON.stringify(helperPaths)}) require(helperPath);`,
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('uploads the R8 mapping file with Android production releases', () => {
    const workflowSource = readFileSync(
      path.resolve(
        ROOT,
        '../../.github/workflows/android-storefront-release.yml'
      ),
      'utf-8'
    );
    expect(workflowSource).toMatch(
      /mappingFile: \$\{\{ env\.WORKING_DIR \}\}\/android\/app\/build\/outputs\/mapping\/release\/mapping\.txt/
    );
  });

  it('exposes the workspace PostHog CLI before the Android release build', () => {
    const workflowSource = readFileSync(
      path.resolve(
        ROOT,
        '../../.github/workflows/android-storefront-release.yml'
      ),
      'utf-8'
    );
    const releaseScriptSource = readFileSync(
      path.resolve(ROOT, '../../.github/scripts/android-storefront-release.sh'),
      'utf-8'
    );
    const installStep = workflowSource.indexOf('name: Install dependencies');
    const exposeStep = workflowSource.indexOf(
      'name: Expose PostHog CLI to Gradle'
    );
    const buildStep = workflowSource.indexOf(
      'name: Build Android App Bundle (storefront)'
    );

    expect(installStep).toBeGreaterThan(-1);
    expect(exposeStep).toBeGreaterThan(installStep);
    expect(buildStep).toBeGreaterThan(exposeStep);
    expect(releaseScriptSource).toContain(
      '$GITHUB_WORKSPACE/node_modules/.bin/posthog-cli'
    );
    expect(releaseScriptSource).toContain('[ ! -x "$POSTHOG_CLI_BIN" ]');
    expect(releaseScriptSource).toContain(
      'dirname "$POSTHOG_CLI_BIN" >> "$GITHUB_PATH"'
    );
  });

  it('uses the supported Node 24 flag to disable type stripping in release workflows', () => {
    const workflowPaths = [
      '../../.github/workflows/android-storefront-release.yml',
      '../../.github/workflows/ios-storefront-release.yml',
    ];

    for (const workflowPath of workflowPaths) {
      const workflowSource = readFileSync(
        path.resolve(ROOT, workflowPath),
        'utf-8'
      );

      expect(workflowSource).toContain('--no-experimental-strip-types');
      expect(workflowSource).not.toMatch(/--no-strip-types(?:\s|")/);
    }
  });

  it('sets the supported iOS deployment target to 16.4', () => {
    const plugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });

    const buildPropertiesPlugin = findPlugin(plugins, 'expo-build-properties');

    expect(buildPropertiesPlugin?.[1]).toMatchObject({
      ios: {
        deploymentTarget: '16.4',
      },
    });
    expect(buildPropertiesPlugin?.[1]).not.toMatchObject({
      ios: {
        deploymentTarget: '15.1',
      },
    });
  });

  it('configures the Expo splash plugin without a static splash image', () => {
    const plugins = createExpoPlugins({
      facebookSdkPlugin: null,
      sentryPlugin: null,
      tiktokBusinessPlugin: null,
    });

    const splashPlugin = findPlugin(plugins, 'expo-splash-screen');

    expect(splashPlugin?.[1]).toEqual({
      backgroundColor: '#000000',
    });
    expect(splashPlugin?.[1]).not.toHaveProperty('image');
    expect(splashPlugin?.[1]).not.toHaveProperty('resizeMode');
    expect(plugins).toContain('./config/withNoSplashImage.js');
  });

  it('gradle.properties does not contain newArchEnabled', () => {
    const filePath = path.join(ROOT, 'android/gradle.properties');
    if (!existsSync(filePath)) return; // generated by prebuild, gitignored
    const gradleProps = readFileSync(filePath, 'utf-8');
    const sourceLines = gradleProps
      .split('\n')
      .filter((l) => !l.startsWith('newArchEnabled'));
    expect(sourceLines.join('\n')).not.toContain('newArchEnabled');
  });

  it('Podfile.properties.json does not contain newArchEnabled', () => {
    const filePath = path.join(ROOT, 'ios/Podfile.properties.json');
    if (!existsSync(filePath)) return; // generated by prebuild, gitignored
    const podfileProps = readFileSync(filePath, 'utf-8');
    expect(podfileProps).not.toContain('newArchEnabled');
  });

  it('uses style.pointerEvents instead of deprecated JSX pointerEvents props', () => {
    const offenders = ['app', 'components', 'hooks']
      .flatMap((sourceDirectory) =>
        findTypeScriptSourceFiles(path.join(ROOT, sourceDirectory))
      )
      .filter((filePath) =>
        /\bpointerEvents\s*=/.test(readFileSync(filePath, 'utf-8'))
      )
      .map((filePath) => path.relative(ROOT, filePath));

    expect(offenders).toEqual([]);
  });
});
