import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveHostedStagingPushConfig } from '../../../tools/staging/mobile-push/resolve-config.mjs';

const require = createRequire(import.meta.url);
const productionConfigPath = fileURLToPath(
  new URL('./development-storefront-expo-config-production.js', import.meta.url)
);

function loadProductionConfigWithEnv(overrides = {}) {
  const previousEnv = process.env;
  process.env = {
    ...previousEnv,
    NODE_ENV: 'test',
    EXPO_UPDATE_CHANNEL: 'production',
    STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
  };
  delete process.env.EXPO_PUBLIC_ENV;
  delete process.env.EAS_BUILD_PROFILE;
  delete process.env.EXPO_PUBLIC_OTA_UPDATES_URL;
  delete process.env.EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH;
  delete process.env.EXPO_PUBLIC_OTA_CODE_SIGNING_KEY_ID;
  delete process.env.EXPO_OTA_CODE_SIGNING_CERTIFICATE_PATH;
  delete process.env.EXPO_OTA_CODE_SIGNING_KEY_ID;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  delete require.cache[productionConfigPath];
  try {
    const { buildStorefrontConfig } = require(productionConfigPath);
    return buildStorefrontConfig({ config: {} });
  } finally {
    delete require.cache[productionConfigPath];
    process.env = previousEnv;
  }
}

test('production EAS still requires all Sentry upload credentials after staging extraction', () => {
  const environment = {
    NODE_ENV: 'test',
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
    STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    EXPO_PUBLIC_SENTRY_DSN: 'https://synthetic.example/1',
    SENTRY_ORG: 'synthetic-org',
    SENTRY_PROJECT: 'synthetic-project',
    SENTRY_AUTH_TOKEN: 'synthetic-upload-token',
  };
  const config = resolveHostedStagingPushConfig(environment, {});
  assert.ok(
    config.plugins.some(
      (plugin) =>
        Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo'
    )
  );
  for (const field of [
    'EXPO_PUBLIC_SENTRY_DSN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'SENTRY_AUTH_TOKEN',
  ]) {
    assert.throws(
      () =>
        resolveHostedStagingPushConfig(
          { ...environment, [field]: undefined },
          {}
        ),
      /Missing required Sentry/
    );
  }
});

test('production dotenv and asset paths remain rooted at the app after factory extraction', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dotenvPaths = [];
  const config = resolveHostedStagingPushConfig(
    {
      NODE_ENV: 'development',
      STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    },
    {},
    (path) => dotenvPaths.push(path)
  );
  assert.deepEqual(dotenvPaths, [resolve(root, '.env')]);
  for (const asset of [
    config.icon,
    config.android.adaptiveIcon.foregroundImage,
    config.web.favicon,
  ]) {
    assert.ok(existsSync(resolve(root, asset)));
  }
  assert.equal(config.ios.googleServicesFile, './GoogleService-Info.plist');
  assert.equal(config.android.googleServicesFile, './google-services.json');
});

test('splash motion native generation has a distinct OTA runtime on both platforms', () => {
  const config = resolveHostedStagingPushConfig(
    {
      NODE_ENV: 'development',
      STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    },
    {}
  );
  assert.equal(
    config.runtimeVersion,
    `${config.version}-ios-sdk58-rn0880-splashmotion1`
  );
  assert.equal(
    config.android.runtimeVersion,
    `${config.version}-android-sdk58-rn0880-splashmotion1`
  );
  assert.notEqual(config.runtimeVersion, `${config.version}-ios-sdk58-rn0880`);
  assert.notEqual(
    config.android.runtimeVersion,
    `${config.version}-android-sdk58-rn0880`
  );
});

test('production updates default to ON_LOAD and fallback EAS URL when no OTA override is set', () => {
  const config = loadProductionConfigWithEnv();
  assert.deepEqual(config.updates, {
    url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': 'production',
    },
  });
});

test('supports EXPO_PUBLIC_OTA_UPDATES_URL and optional code signing certificate path', () => {
  const config = loadProductionConfigWithEnv({
    EXPO_PUBLIC_OTA_UPDATES_URL: '  https://ota.usebaci.com/api/manifest  ',
    EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH: './certs/ota-cert.pem',
    EXPO_PUBLIC_OTA_CODE_SIGNING_KEY_ID: 'baci-2026',
  });
  assert.deepEqual(config.updates, {
    url: 'https://ota.usebaci.com/api/manifest',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': 'production',
    },
    codeSigningCertificate: './certs/ota-cert.pem',
    codeSigningMetadata: {
      alg: 'rsa-v1_5-sha256',
      keyid: 'baci-2026',
    },
  });
});

test('rejects inline PEM contents or missing build-time certificate path', () => {
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH:
          '-----BEGIN CERTIFICATE-----\nMIIB...',
      }),
    /not inline PEM contents/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH: '/abs/cert.pem',
      }),
    /relative \.pem\/\.crt\/\.cer path/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EAS_BUILD: 'true',
        EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH: './certs/missing.pem',
      }),
    /does not exist on disk/
  );
});

test('rejects invalid or non-HTTPS EXPO_PUBLIC_OTA_UPDATES_URL', () => {
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_UPDATES_URL: 'http://ota.usebaci.com/api/manifest',
      }),
    /Must use https/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_UPDATES_URL: 'not-a-url',
      }),
    /Must be a valid https URL/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_UPDATES_URL:
          'https://user:pass@ota.usebaci.com/api/manifest',
      }),
    /without credentials, query, fragment, or loopback host/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_UPDATES_URL: 'https://localhost/api/manifest',
      }),
    /without credentials, query, fragment, or loopback host/
  );
  assert.throws(
    () =>
      loadProductionConfigWithEnv({
        EXPO_PUBLIC_OTA_UPDATES_URL: 'https://127.0.0.2/api/manifest',
      }),
    /without credentials, query, fragment, or loopback host/
  );
});
