const { withInfoPlist } = require('expo/config-plugins');

const INFO_PLIST_KEYS = {
  appId: 'BaciTikTokBusinessAppId',
  appSecret: 'BaciTikTokBusinessAppSecret',
  autoInitialize: 'BaciTikTokBusinessAutoInitialize',
  debugMode: 'BaciTikTokBusinessDebugMode',
  disablePaymentTracking: 'BaciTikTokBusinessDisablePaymentTracking',
  disableSKAdNetworkSupport: 'BaciTikTokBusinessDisableSKAdNetworkSupport',
  tiktokAppId: 'BaciTikTokBusinessTikTokAppId',
};

function createTikTokBusinessInfoPlistEntries(ios, environment = process.env) {
  const environmentSecret = ios.appSecretEnvVar
    ? environment[ios.appSecretEnvVar]?.trim()
    : undefined;
  const appSecret = ios.appSecret ?? environmentSecret;
  if (typeof appSecret !== 'string' || !appSecret.trim()) {
    throw new Error('TikTok business app secret is missing for iOS prebuild.');
  }
  return {
    [INFO_PLIST_KEYS.appId]: ios.appId,
    [INFO_PLIST_KEYS.tiktokAppId]: ios.tiktokAppId,
    [INFO_PLIST_KEYS.appSecret]: appSecret,
    // Preserve launch-time initialization for existing consumers unless they
    // explicitly opt into consent-gated initialization.
    [INFO_PLIST_KEYS.autoInitialize]: ios.autoInitialize !== false,
    [INFO_PLIST_KEYS.debugMode]: Boolean(ios.debugMode),
    [INFO_PLIST_KEYS.disablePaymentTracking]: Boolean(
      ios.disablePaymentTracking
    ),
    [INFO_PLIST_KEYS.disableSKAdNetworkSupport]: Boolean(
      ios.disableSKAdNetworkSupport
    ),
  };
}

const withBaciTikTokBusiness = (config, { ios } = {}) => {
  if (!ios) {
    return config;
  }

  return withInfoPlist(config, (nextConfig) => {
    Object.assign(
      nextConfig.modResults,
      createTikTokBusinessInfoPlistEntries(ios)
    );
    return nextConfig;
  });
};

module.exports = withBaciTikTokBusiness;
module.exports.createTikTokBusinessInfoPlistEntries =
  createTikTokBusinessInfoPlistEntries;
