import { STOREFRONT_OTA_CONFIG } from './storefront-ota-constants.mjs';

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateOtaConfig(config, runtimeVersion) {
  if ((config.ios?.runtimeVersion ?? config.runtimeVersion) !== runtimeVersion) {
    throw new Error('Export runtime does not match the selected iOS runtime.');
  }
  if (config.ios?.buildNumber !== runtimeVersion.split('.').at(-1)) {
    throw new Error('Export iOS build number does not match the runtime.');
  }
  if (
    config.ios?.bundleIdentifier !== STOREFRONT_OTA_CONFIG.bundleIdentifier ||
    config.extra?.eas?.projectId !== STOREFRONT_OTA_CONFIG.projectId ||
    config.updates?.url !== STOREFRONT_OTA_CONFIG.updatesUrl ||
    config.updates?.requestHeaders?.['expo-channel-name'] !== STOREFRONT_OTA_CONFIG.channel
  ) {
    throw new Error('Export app, Expo project, or update channel is incorrect.');
  }
  if (
    config.extra?.merchantId !== STOREFRONT_OTA_CONFIG.merchantId ||
    config.extra?.merchantSlug !== STOREFRONT_OTA_CONFIG.merchantSlug ||
    config.extra?.merchantDomain !== STOREFRONT_OTA_CONFIG.merchantDomain
  ) {
    throw new Error('Export merchant configuration is incorrect.');
  }
  if (
    !present(config.extra?.supabaseUrl) ||
    !(present(config.extra?.supabaseAnonKey) || present(config.extra?.supabasePublishableKey))
  ) {
    throw new Error('Export is missing public Supabase configuration.');
  }
  if (
    config.extra?.apiUrl !== STOREFRONT_OTA_CONFIG.apiUrl ||
    !present(config.extra?.posthogApiKey) ||
    !present(config.extra?.facebookAppId) ||
    !present(config.extra?.facebookClientToken)
  ) {
    throw new Error('Export is missing required production app configuration.');
  }
}
