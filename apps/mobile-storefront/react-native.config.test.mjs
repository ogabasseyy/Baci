import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configPath = require.resolve('./react-native.config.js');

const environmentKeys = [
  'EXPO_PUBLIC_ENV',
  'EXPO_PUBLIC_HOSTED_STOREFRONT',
  'NODE_ENV',
  'EAS_BUILD',
  'EAS_BUILD_PROFILE',
  'CI',
  'BACI_REVIEWED_HOSTED_PUSH_BUILD',
];

function loadConfiguration(environment = {}) {
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]])
  );
  for (const key of environmentKeys) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
  delete require.cache[configPath];
  try {
    return require(configPath);
  } finally {
    delete require.cache[configPath];
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const advertisingSdkNames = [
  'react-native-google-mobile-ads',
  'react-native-fbsdk-next',
];

test('isolated hosted staging excludes both advertising SDKs on iOS and Android', () => {
  const configuration = loadConfiguration({
    NODE_ENV: 'development',
    EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  });
  for (const dependency of advertisingSdkNames) {
    assert.deepEqual(configuration.dependencies[dependency].platforms, {
      ios: null,
      android: null,
    });
  }
});

test('production build links both advertising SDKs on iOS and Android', () => {
  const configuration = loadConfiguration({
    EXPO_PUBLIC_ENV: 'production',
    NODE_ENV: 'production',
  });
  for (const dependency of advertisingSdkNames) {
    assert.equal(configuration.dependencies[dependency], undefined);
  }
});

test('production remains the safe default when no build environment is set', () => {
  const configuration = loadConfiguration(undefined);
  for (const dependency of advertisingSdkNames) {
    assert.equal(configuration.dependencies[dependency], undefined);
  }
});

test('ordinary development keeps the advertising dependencies', () => {
  const configuration = loadConfiguration({
    EXPO_PUBLIC_ENV: 'development',
    NODE_ENV: 'development',
  });
  for (const dependency of advertisingSdkNames) {
    assert.equal(configuration.dependencies[dependency], undefined);
  }
});

test('ordinary preview retains advertising SDKs', () => {
  const configuration = loadConfiguration({
    EXPO_PUBLIC_ENV: 'preview',
    NODE_ENV: 'production',
  });
  for (const dependency of advertisingSdkNames)
    assert.equal(configuration.dependencies[dependency], undefined);
});

test('reviewed hosted push build excludes advertising SDKs', () => {
  const configuration = loadConfiguration({
    EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'hosted-staging-push',
    BACI_REVIEWED_HOSTED_PUSH_BUILD: '1',
  });
  for (const dependency of advertisingSdkNames)
    assert.deepEqual(configuration.dependencies[dependency].platforms, {
      ios: null,
      android: null,
    });
});

test('a stray hosted flag does not exclude SDKs from production', () => {
  const configuration = loadConfiguration({
    EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
    EXPO_PUBLIC_ENV: 'production',
    NODE_ENV: 'production',
  });
  for (const dependency of advertisingSdkNames)
    assert.equal(configuration.dependencies[dependency], undefined);
});

test('Expo config retains the native plugin declarations for production SDK linking', () => {
  const googleAdsConfig = require('./config/google-mobile-ads-config.js');
  const googlePlugin = googleAdsConfig.buildGoogleMobileAdsExpoPlugin({
    EXPO_PUBLIC_ENV: 'production',
    STOREFRONT_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1111111111',
    STOREFRONT_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~2222222222',
  });
  assert.equal(googlePlugin[0], advertisingSdkNames[0]);

  const { createExpoPlugins } = require('./config/expo-plugins.js');
  const plugins = createExpoPlugins({
    facebookSdkPlugin: [advertisingSdkNames[1], { appID: '1234567890' }],
    sentryPlugin: null,
    tiktokBusinessPlugin: null,
  });
  assert.ok(
    plugins.some(
      (plugin) => Array.isArray(plugin) && plugin[0] === advertisingSdkNames[1]
    )
  );
});
