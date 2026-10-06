const { createHash } = require('node:crypto');
const pins = require('./hosted-storefront-pins.json');
const {
  buildLocalStorefrontExpoConfig,
} = require('./local-storefront-expo-config');

const {
  validateHostedStagingPushCapability,
} = require('./hosted-staging-push-capability');

function buildHostedStagingPushCapability(profile) {
  const capability = profile.nativeStagingPush;
  if (capability === undefined) return null;
  if (!validateHostedStagingPushCapability(capability, profile).valid)
    throw new Error(
      'Hosted staging push capability does not match reviewed pins'
    );
  return { ...capability, allowedOrigins: [...capability.allowedOrigins] };
}

function buildDevelopmentStorefrontExpoConfig(inputEnvironment) {
  let environment = inputEnvironment;
  if (environment.EAS_BUILD_PROFILE === 'hosted-staging-push') {
    const {
      prepareHostedStagingPushBuild,
    } = require('./hosted-staging-push-build');
    environment = prepareHostedStagingPushBuild(environment, pins);
  }
  const mode = environment.EXPO_PUBLIC_HOSTED_STOREFRONT;
  if ([undefined, '', '0'].includes(mode))
    return buildLocalStorefrontExpoConfig(environment);
  if (
    mode !== '1' ||
    environment.NODE_ENV !== 'development' ||
    environment.EAS_BUILD ||
    environment.CI ||
    ![undefined, '', '0'].includes(environment.EXPO_PUBLIC_LOCAL_STOREFRONT) ||
    ![undefined, '', '0'].includes(environment.EXPO_PUBLIC_PHONE_QA)
  )
    throw new Error(
      'Hosted storefront requires an isolated development launch'
    );
  const key = environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    typeof key !== 'string' ||
    key.length > 8192 ||
    key !== environment.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    createHash('sha256').update(key).digest('hex') !== pins.publicKeySha256 ||
    environment.EXPO_PUBLIC_API_URL !== pins.apiOrigin ||
    environment.EXPO_PUBLIC_SUPABASE_URL !== pins.supabaseOrigin ||
    environment.EXPO_PUBLIC_MERCHANT_ID !== pins.merchantId ||
    environment.EXPO_PUBLIC_SENTRY_DSN
  )
    throw new Error(
      'Hosted storefront configuration does not match reviewed pins'
    );
  const nativeStagingPush = buildHostedStagingPushCapability(pins);
  return {
    name: 'Ogabassey Staging',
    slug: 'ogabassey-store',
    version: '2.0.1',
    scheme: 'ogabassey',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier:
        nativeStagingPush?.iosBundleIdentifier ?? 'com.ogabassey.app',
      supportsTablet: true,
    },
    android: {
      package: nativeStagingPush?.androidPackage ?? 'com.ogabassey.store',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-secure-store',
      'expo-web-browser',
      ...(nativeStagingPush
        ? [
            'expo-dev-client',
            [
              'expo-notifications',
              {
                icon: './assets/images/icon.png',
                color: '#000000',
                defaultChannel: 'savings',
              },
            ],
          ]
        : []),
    ],
    updates: { enabled: false },
    extra: {
      localStorefront: false,
      hostedStorefront: true,
      merchantId: pins.merchantId,
      merchantSlug: 'savings-synthetic',
      merchantDomain: 'staging.ogabassey.com',
      templateId: 'ogabassey',
      businessType: 'electronics',
      apiUrl: pins.apiOrigin,
      supabaseUrl: pins.supabaseOrigin,
      supabaseAnonKey: key,
      supabasePublishableKey: key,
      posthogApiKey: '',
      posthogHost: pins.apiOrigin,
      facebookAppId: '',
      facebookClientToken: '',
      tiktokBusiness: { isConfigured: false },
      eas: nativeStagingPush ? { projectId: nativeStagingPush.projectId } : {},
      ...(nativeStagingPush ? { hostedStagingPush: nativeStagingPush } : {}),
    },
  };
}

module.exports = { buildDevelopmentStorefrontExpoConfig };
