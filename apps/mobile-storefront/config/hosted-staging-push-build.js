const { createHash } = require('node:crypto');

const PROFILE = 'hosted-staging-push';
const API_ORIGIN = 'https://staging.ogabassey.com';
const AUTH_ORIGIN = 'https://staging-auth.ogabassey.com';
const MERCHANT_ID = '10000000-0000-4000-8000-000000000001';
const {
  validateHostedStagingPushCapability,
} = require('./hosted-staging-push-capability');

function prepareHostedStagingPushBuild(environment, pins) {
  if (
    environment?.EAS_BUILD !== 'true' ||
    environment.EAS_BUILD_PROFILE !== PROFILE ||
    environment.BACI_REVIEWED_HOSTED_PUSH_BUILD !== '1'
  )
    throw new Error('Hosted push build requires the reviewed EAS profile');
  if (
    pins?.mode !== 'hosted-staging' ||
    pins.apiOrigin !== API_ORIGIN ||
    pins.supabaseOrigin !== AUTH_ORIGIN ||
    pins.expectedAuthIssuer !== `${AUTH_ORIGIN}/auth/v1` ||
    pins.merchantId !== MERCHANT_ID ||
    typeof pins.publicKeySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pins.publicKeySha256)
  )
    throw new Error(
      'Hosted push build requires unchanged reviewed staging pins'
    );
  const capability = pins.nativeStagingPush;
  if (!validateHostedStagingPushCapability(capability, pins).valid)
    throw new Error('Hosted push build requires separate reviewed native pins');
  const key = environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    environment.EXPO_PUBLIC_HOSTED_STOREFRONT !== '1' ||
    environment.EXPO_PUBLIC_API_URL !== API_ORIGIN ||
    environment.EXPO_PUBLIC_SUPABASE_URL !== AUTH_ORIGIN ||
    environment.EXPO_PUBLIC_MERCHANT_ID !== MERCHANT_ID ||
    typeof key !== 'string' ||
    !key ||
    key.length > 8192 ||
    key !== environment.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    createHash('sha256').update(key).digest('hex') !== pins.publicKeySha256 ||
    environment.EXPO_PUBLIC_POSTHOG_API_KEY !== '' ||
    ![undefined, '', API_ORIGIN].includes(
      environment.EXPO_PUBLIC_POSTHOG_HOST
    ) ||
    ![undefined, 'development'].includes(environment.EXPO_PUBLIC_ENV) ||
    ['EXPO_PUBLIC_LOCAL_STOREFRONT', 'EXPO_PUBLIC_PHONE_QA'].some(
      (field) => ![undefined, '', '0'].includes(environment[field])
    ) ||
    [
      'EXPO_PUBLIC_SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'STOREFRONT_FACEBOOK_APP_ID',
      'STOREFRONT_FACEBOOK_CLIENT_TOKEN',
      'STOREFRONT_TIKTOK_APP_SECRET',
    ].some((field) => ![undefined, ''].includes(environment[field]))
  )
    throw new Error(
      'Hosted push build environment does not match reviewed pins'
    );
  return {
    ...environment,
    NODE_ENV: 'development',
    EAS_BUILD: undefined,
    CI: undefined,
  };
}

module.exports = { prepareHostedStagingPushBuild };
