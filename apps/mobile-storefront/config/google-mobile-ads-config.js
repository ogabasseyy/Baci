const APP_ID_PATTERN = /^ca-app-pub-\d+~\d+$/;
const UNIT_ID_PATTERN = /^ca-app-pub-\d+\/\d+$/;
const SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
const SAMPLE_APP_IDS = new Set([SAMPLE_ANDROID_APP_ID, SAMPLE_IOS_APP_ID]);
const SAMPLE_ANDROID_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/9214589741';
const SAMPLE_IOS_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/2435281174';
const SAMPLE_BANNER_UNIT_IDS = new Set([
  SAMPLE_ANDROID_BANNER_UNIT_ID,
  SAMPLE_IOS_BANNER_UNIT_ID,
]);
const TRACKING_USAGE_DESCRIPTION =
  'We use your activity to measure advertising performance and show more relevant offers across apps and websites.';

function requiredIdentifier(environment, key, pattern, disallowedValues) {
  const value = environment[key]?.trim();
  if (!value || !pattern.test(value) || disallowedValues?.has(value)) {
    throw new Error(
      `[google-mobile-ads] ${key} must be a valid Google Mobile Ads identifier.`
    );
  }
  return value;
}

function buildGoogleMobileAdsExpoPlugin(environment) {
  const environmentName =
    environment.EXPO_PUBLIC_ENV?.trim() ||
    environment.EAS_BUILD_PROFILE?.trim() ||
    (environment.NODE_ENV === 'production' ? 'production' : 'development');
  const isProduction = environmentName === 'production';
  const adsEnabled = environment.EXPO_PUBLIC_QUIZ_ADS_ENABLED === 'true';

  const androidAppId = isProduction
    ? requiredIdentifier(
        environment,
        'STOREFRONT_ADMOB_ANDROID_APP_ID',
        APP_ID_PATTERN,
        SAMPLE_APP_IDS
      )
    : SAMPLE_ANDROID_APP_ID;
  const iosAppId = isProduction
    ? requiredIdentifier(
        environment,
        'STOREFRONT_ADMOB_IOS_APP_ID',
        APP_ID_PATTERN,
        SAMPLE_APP_IDS
      )
    : SAMPLE_IOS_APP_ID;

  if (isProduction && adsEnabled) {
    for (const key of [
      'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
      'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
    ]) {
      requiredIdentifier(
        environment,
        key,
        UNIT_ID_PATTERN,
        SAMPLE_BANNER_UNIT_IDS
      );
    }
  }

  return [
    'react-native-google-mobile-ads',
    {
      androidAppId,
      delayAppMeasurementInit: true,
      iosAppId,
      userTrackingUsageDescription: TRACKING_USAGE_DESCRIPTION,
    },
  ];
}

module.exports = { buildGoogleMobileAdsExpoPlugin };
