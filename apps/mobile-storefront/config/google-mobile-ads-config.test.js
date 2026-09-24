const {
  buildGoogleMobileAdsExpoPlugin,
} = require('./google-mobile-ads-config');

const SAMPLE_PLUGIN = [
  'react-native-google-mobile-ads',
  {
    androidAppId: 'ca-app-pub-3940256099942544~3347511713',
    delayAppMeasurementInit: true,
    iosAppId: 'ca-app-pub-3940256099942544~1458002511',
    userTrackingUsageDescription:
      'We use your activity to measure advertising performance and show more relevant offers across apps and websites.',
  },
];

const PRODUCTION_PLUGIN = [
  'react-native-google-mobile-ads',
  {
    androidAppId: 'ca-app-pub-1234567890123456~1111111111',
    delayAppMeasurementInit: true,
    iosAppId: 'ca-app-pub-1234567890123456~2222222222',
    userTrackingUsageDescription:
      'We use your activity to measure advertising performance and show more relevant offers across apps and websites.',
  },
];

const productionEnvironment = {
  EXPO_PUBLIC_ENV: 'production',
  EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'true',
  EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID:
    'ca-app-pub-1234567890123456/3333333333',
  EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID:
    'ca-app-pub-1234567890123456/4444444444',
  STOREFRONT_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1111111111',
  STOREFRONT_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~2222222222',
};

describe('Google Mobile Ads Expo configuration', () => {
  it('uses Google sample app IDs in development even when runtime ads are disabled', () => {
    expect(
      buildGoogleMobileAdsExpoPlugin({
        EXPO_PUBLIC_ENV: 'development',
        EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'false',
      })
    ).toEqual(SAMPLE_PLUGIN);
  });

  it('configures the banner-only MVP without deferred interstitial IDs', () => {
    expect(buildGoogleMobileAdsExpoPlugin(productionEnvironment)).toEqual(
      PRODUCTION_PLUGIN
    );
  });

  it('requires production app IDs even when runtime ads are disabled', () => {
    expect(() =>
      buildGoogleMobileAdsExpoPlugin({
        EXPO_PUBLIC_ENV: 'production',
        EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'false',
      })
    ).toThrow('STOREFRONT_ADMOB_ANDROID_APP_ID');
  });

  it('does not require banner unit IDs while production runtime ads are disabled', () => {
    expect(
      buildGoogleMobileAdsExpoPlugin({
        EXPO_PUBLIC_ENV: 'production',
        EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'false',
        STOREFRONT_ADMOB_ANDROID_APP_ID:
          'ca-app-pub-1234567890123456~1111111111',
        STOREFRONT_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~2222222222',
      })
    ).toEqual(PRODUCTION_PLUGIN);
  });

  it('rejects Google sample app IDs in production', () => {
    expect(() =>
      buildGoogleMobileAdsExpoPlugin({
        ...productionEnvironment,
        STOREFRONT_ADMOB_ANDROID_APP_ID:
          'ca-app-pub-3940256099942544~3347511713',
      })
    ).toThrow('STOREFRONT_ADMOB_ANDROID_APP_ID');
  });

  it.each([
    [
      'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
      'ca-app-pub-3940256099942544/9214589741',
    ],
    [
      'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
      'ca-app-pub-3940256099942544/2435281174',
    ],
  ])('rejects Google sample banner unit ID %s in production', (key, value) => {
    expect(() =>
      buildGoogleMobileAdsExpoPlugin({
        ...productionEnvironment,
        [key]: value,
      })
    ).toThrow(key);
  });

  it.each([
    'STOREFRONT_ADMOB_ANDROID_APP_ID',
    'STOREFRONT_ADMOB_IOS_APP_ID',
    'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
    'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
  ])('fails closed when %s is missing', (key) => {
    const environment = { ...productionEnvironment };
    delete environment[key];

    expect(() => buildGoogleMobileAdsExpoPlugin(environment)).toThrow(key);
  });

  it('rejects malformed app and unit identifiers', () => {
    expect(() =>
      buildGoogleMobileAdsExpoPlugin({
        ...productionEnvironment,
        STOREFRONT_ADMOB_ANDROID_APP_ID: 'demo-app-id',
      })
    ).toThrow('STOREFRONT_ADMOB_ANDROID_APP_ID');
    expect(() =>
      buildGoogleMobileAdsExpoPlugin({
        ...productionEnvironment,
        EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID: 'demo-unit-id',
      })
    ).toThrow('EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID');
  });
});
