import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  loadAppConfigWithEnv,
  resetAppConfigEnv,
} from './app.config.test-utils';

// Keep app-config tests hermetic by preventing dotenv from loading local .env.
jest.mock('dotenv/config', () => ({}));

describe('Expo app config (production builder compatibility)', () => {
  it('preserves the original typed factory import after moving the Expo loader to CommonJS', () => {
    const appConfig = loadAppConfigWithEnv({
      STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    });
    // Explicit `.ts` specifier: both the shim (.ts) and the runtime source
    // (.js) exist, so an extensionless require would resolve ambiguously.
    // This pins the typed compatibility entry, not the .js export.
    const { buildStorefrontConfig } = jest.requireActual<
      typeof import('./config/development-storefront-expo-config-production')
    >('./config/development-storefront-expo-config-production.ts');

    expect(buildStorefrontConfig).toBe(appConfig);
  });

  afterEach(() => {
    resetAppConfigEnv();
  });

  it('loads the production builder through the explicit .js require when no dev-mode flag is set', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    // Same explicit `.js` specifier app.config.ts uses: pins the
    // production branch (not the dev closure) and fails loudly if the
    // specifier stops resolving under a future loader. Rendered markers
    // cannot distinguish the branches (slug/scheme/bundle id match).
    const production = jest.requireActual<
      typeof import('./config/development-storefront-expo-config-production')
    >('./config/development-storefront-expo-config-production.js');
    expect(appConfig).toBe(production.buildStorefrontConfig);
  });

  it('keeps the production .ts shim free of logic', () => {
    // The .js file is the runtime source of truth; any behavior added to
    // the .ts shim alone would silently do nothing, so pin its exact
    // shape: type import plus a pure re-export, nothing else.
    const shimSource = readFileSync(
      path.join(
        __dirname,
        'config/development-storefront-expo-config-production.ts'
      ),
      'utf-8'
    );
    const codeLines = shimSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'));
    expect(codeLines).toEqual([
      `import type { ConfigContext, ExpoConfig } from 'expo/config';`,
      'export const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =',
      `require('./development-storefront-expo-config-production.js').buildStorefrontConfig;`,
    ]);
  });
});
