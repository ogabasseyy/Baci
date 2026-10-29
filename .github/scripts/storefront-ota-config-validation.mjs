const PROJECT_ID = 'c6c1897b-cac8-49b0-85f9-3d277aecc379';

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
    config.ios?.bundleIdentifier !== 'com.ogabassey.app' ||
    config.extra?.eas?.projectId !== PROJECT_ID ||
    config.updates?.url !== `https://u.expo.dev/${PROJECT_ID}` ||
    config.updates?.requestHeaders?.['expo-channel-name'] !== 'production'
  ) {
    throw new Error('Export app, Expo project, or update channel is incorrect.');
  }
  if (
    config.extra?.merchantId !== '6b5cb8a4-5575-456c-b936-8cdfae30db74' ||
    config.extra?.merchantSlug !== 'ogabassey' ||
    config.extra?.merchantDomain !== 'ogabassey.com'
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
    config.extra?.apiUrl !== 'https://usebaci.com' ||
    !present(config.extra?.posthogApiKey) ||
    !present(config.extra?.facebookAppId) ||
    !present(config.extra?.facebookClientToken)
  ) {
    throw new Error('Export is missing required production app configuration.');
  }
}
