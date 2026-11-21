const { readOxygenStagingProfile } = require('./oxygen-staging-profile');
function buildOxygenStagingExpoConfig(env) {
  if (env.EXPO_PUBLIC_OXYGEN_STAGING !== '1') return null;
  if (
    env.NODE_ENV !== 'development' ||
    env.EAS_BUILD ||
    env.EAS_BUILD_PROFILE ||
    env.CI ||
    env.EXPO_PUBLIC_QUIZ_ADS_ENABLED === 'true' ||
    [
      'EXPO_PUBLIC_LOCAL_STOREFRONT',
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_PHONE_QA',
    ].some((key) => ![undefined, '', '0'].includes(env[key])) ||
    [
      'EXPO_PUBLIC_SENTRY_DSN',
      'EXPO_PUBLIC_POSTHOG_API_KEY',
      'EXPO_PUBLIC_FACEBOOK_APP_ID',
      'EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN',
      'EXPO_PUBLIC_TIKTOK_APP_ID',
    ].some((key) => env[key])
  )
    throw new Error(
      'Oxygen staging requires an isolated development launch without exporters'
    );
  const profile = readOxygenStagingProfile(
    {
      apiOrigin: env.EXPO_PUBLIC_OXYGEN_API_ORIGIN,
      authOrigin: env.EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN,
      authBaseUrl: env.EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL || undefined,
      expectedAuthIssuer: env.EXPO_PUBLIC_OXYGEN_AUTH_ISSUER,
      publicKey: env.EXPO_PUBLIC_OXYGEN_PUBLIC_KEY,
      merchantId: env.EXPO_PUBLIC_OXYGEN_MERCHANT_ID,
      merchantSlug: env.EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG,
    },
    true
  );
  for (const [key, pin] of Object.entries({
    EXPO_PUBLIC_API_URL: profile.apiOrigin,
    EXPO_PUBLIC_SUPABASE_URL: profile.authBaseUrl,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: profile.publicKey,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: profile.publicKey,
    EXPO_PUBLIC_MERCHANT_ID: profile.merchantId,
  })) {
    if (env[key] && env[key] !== pin)
      throw new Error(
        'Oxygen staging rejects inherited production configuration'
      );
  }
  return {
    name: 'Ogabassey Oxygen Staging',
    slug: 'ogabassey-oxygen-staging',
    version: '2.0.1',
    scheme: 'ogabassey-oxygen-staging',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: profile.appId,
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: 'Verify your identity with Oxygen.',
        ...(profile.apiOrigin.startsWith('http:')
          ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }
          : {}),
      },
    },
    android: { package: profile.appId },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-secure-store',
      'expo-web-browser',
      'expo-dev-client',
      './config/withOxygenStagingAndroidIsolation',
    ],
    updates: { enabled: false },
    extra: {
      oxygenStaging: profile,
      apiUrl: profile.apiOrigin,
      supabaseUrl: profile.authBaseUrl,
      supabasePublishableKey: profile.publicKey,
      supabaseAnonKey: profile.publicKey,
      merchantId: profile.merchantId,
      merchantSlug: profile.merchantSlug,
      templateId: 'ogabassey',
      businessType: 'electronics',
      posthogApiKey: '',
      posthogHost: profile.apiOrigin,
      facebookAppId: '',
      facebookClientToken: '',
      tiktokBusiness: { isConfigured: false },
      eas: {},
    },
  };
}
module.exports = { buildOxygenStagingExpoConfig };
