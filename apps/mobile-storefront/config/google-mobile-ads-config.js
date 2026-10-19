const APP_ID_PATTERN = /^ca-app-pub-\d+~\d+$/;
const UNIT_ID_PATTERN = /^ca-app-pub-\d+\/\d+$/;
const SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
const SAMPLE_APP_IDS = new Set([SAMPLE_ANDROID_APP_ID, SAMPLE_IOS_APP_ID]);
const SAMPLE_BANNER_UNIT_IDS = new Set([
  'ca-app-pub-3940256099942544/6300978111',
  'ca-app-pub-3940256099942544/2934735716',
  'ca-app-pub-3940256099942544/9214589741',
  'ca-app-pub-3940256099942544/2435281174',
]);
const SAMPLE_REWARDED_UNIT_IDS = new Set([
  'ca-app-pub-3940256099942544/5224354917',
  'ca-app-pub-3940256099942544/1712485313',
]);
const SAMPLE_UNIT_IDS = new Set([
  ...SAMPLE_BANNER_UNIT_IDS,
  ...SAMPLE_REWARDED_UNIT_IDS,
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

function requiredBannerUnitKeys(environment) {
  switch (environment.BACI_MOBILE_BUILD_PLATFORM?.trim()) {
    case 'android':
      return ['EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID'];
    case 'ios':
      return ['EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID'];
    default:
      return [
        'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
        'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
      ];
  }
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
    for (const key of requiredBannerUnitKeys(environment)) {
      requiredIdentifier(
        environment,
        key,
        UNIT_ID_PATTERN,
        SAMPLE_BANNER_UNIT_IDS
      );
    }
    for (const key of [
      'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID',
      'EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID',
    ]) {
      if (environment[key]?.trim()) {
        requiredIdentifier(environment, key, UNIT_ID_PATTERN, SAMPLE_UNIT_IDS);
      }
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
