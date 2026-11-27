import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildStorefrontOtaUpdatesConfiguration,
} = require('./ota-updates-config.js');

test('buildStorefrontOtaUpdatesConfiguration defaults to EAS updates without signing metadata', () => {
  assert.deepEqual(
    buildStorefrontOtaUpdatesConfiguration({}, { updateChannel: 'production' }),
    {
      url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      requestHeaders: {
        'expo-channel-name': 'production',
      },
    }
  );
});

test('buildStorefrontOtaUpdatesConfiguration configures self-hosted URL and verifies EAS cert existence', () => {
  assert.deepEqual(
    buildStorefrontOtaUpdatesConfiguration(
      {
        EAS_BUILD: 'true',
        EXPO_PUBLIC_OTA_UPDATES_URL: 'https://ota.ogabassey.com/api/manifest',
        EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH:
          './certs/ota-code-signing.crt',
        EXPO_PUBLIC_OTA_CODE_SIGNING_KEY_ID: 'baci-2026',
      },
      { updateChannel: 'preview' }
    ),
    {
      url: 'https://ota.ogabassey.com/api/manifest',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      requestHeaders: {
        'expo-channel-name': 'preview',
      },
      codeSigningCertificate: './certs/ota-code-signing.crt',
      codeSigningMetadata: {
        alg: 'rsa-v1_5-sha256',
        keyid: 'baci-2026',
      },
    }
  );
});

test('buildStorefrontOtaUpdatesConfiguration rejects path traversal and unsigned self-hosted omission', () => {
  assert.throws(
    () =>
      buildStorefrontOtaUpdatesConfiguration(
        {
          EXPO_PUBLIC_OTA_UPDATES_URL: 'https://ota.ogabassey.com/api/manifest',
          EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH: '../secret.crt',
        },
        { updateChannel: 'production' }
      ),
    /relative \.pem\/\.crt\/\.cer path/
  );
  assert.throws(
    () =>
      buildStorefrontOtaUpdatesConfiguration(
        {
          EXPO_PUBLIC_OTA_UPDATES_URL: 'https://ota.ogabassey.com/api/manifest',
        },
        { updateChannel: 'production' }
      ),
    /requires EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH unless EXPO_PUBLIC_OTA_ALLOW_UNSIGNED=true/
  );
});
