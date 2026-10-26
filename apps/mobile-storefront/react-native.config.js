// Mirror the isolated hosted storefront entry points used by app.config.
// A normal preview or release build retains its advertising native modules.
const hosted = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1';
const isolatedDevelopment =
  process.env.NODE_ENV === 'development' &&
  !process.env.EAS_BUILD &&
  !process.env.CI;
const reviewedHostedPush =
  process.env.EAS_BUILD === 'true' &&
  process.env.EAS_BUILD_PROFILE === 'hosted-staging-push' &&
  process.env.BACI_REVIEWED_HOSTED_PUSH_BUILD === '1';
const isStaging = hosted && (isolatedDevelopment || reviewedHostedPush);

const dependencies = {};

if (isStaging) {
  for (const name of [
    'react-native-google-mobile-ads',
    'react-native-fbsdk-next',
  ]) {
    dependencies[name] = { platforms: { ios: null, android: null } };
  }
}

module.exports = { dependencies };
