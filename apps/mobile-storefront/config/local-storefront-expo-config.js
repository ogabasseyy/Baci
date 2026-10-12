function buildLocalStorefrontExpoConfig(environment) {
  if (environment.EXPO_PUBLIC_LOCAL_STOREFRONT !== '1') return null;
  if (
    environment.NODE_ENV !== 'development' ||
    environment.EAS_BUILD ||
    environment.CI
  )
    throw new Error(
      'Local storefront config requires an isolated development launch'
    );
  const {
    buildLocalStorefrontEnvironment,
  } = require('../../../tools/test/local-storefront-environment.mjs');
  const { environment: local } = buildLocalStorefrontEnvironment({
    apiOrigin: environment.EXPO_PUBLIC_API_URL,
    supabaseOrigin: environment.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: environment.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    token: environment.EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN,
    expectedAuthIssuer: environment.EXPO_PUBLIC_LOCAL_AUTH_ISSUER,
    merchantId: environment.EXPO_PUBLIC_MERCHANT_ID,
  });
  return {
    name: 'Ogabassey Local',
    slug: 'ogabassey-store',
    version: '2.0.1',
    scheme: 'ogabassey',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: 'com.ogabassey.app', supportsTablet: true },
    android: { package: 'com.ogabassey.store' },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-secure-store',
      'expo-web-browser',
    ],
    updates: { enabled: false },
    extra: {
      localStorefront: true,
      localAuthIssuer: local.EXPO_PUBLIC_LOCAL_AUTH_ISSUER,
      merchantId: local.EXPO_PUBLIC_MERCHANT_ID,
      merchantSlug: 'ogabassey',
      merchantDomain: local.EXPO_PUBLIC_MERCHANT_DOMAIN,
      templateId: 'default',
      businessType: 'electronics',
      apiUrl: local.EXPO_PUBLIC_API_URL,
      supabaseUrl: local.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: local.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      supabasePublishableKey: local.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      posthogApiKey: '',
      posthogHost: local.EXPO_PUBLIC_API_URL,
      facebookAppId: '',
      facebookClientToken: '',
      tiktokBusiness: { isConfigured: false },
      eas: {},
    },
  };
}

module.exports = { buildLocalStorefrontExpoConfig };
