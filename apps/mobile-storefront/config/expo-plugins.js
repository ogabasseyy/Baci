const {
  buildGoogleMobileAdsExpoPlugin,
} = require('./google-mobile-ads-config');

function createExpoPlugins({
  facebookSdkPlugin,
  sentryPlugin,
  tiktokBusinessPlugin,
}) {
  const googleMobileAdsPlugin = buildGoogleMobileAdsExpoPlugin(process.env);
  return [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#000000',
      },
    ],
    [
      'expo-navigation-bar',
      {
        enforceContrast: false,
        hidden: false,
        style: 'dark',
      },
    ],
    'expo-font',
    'expo-audio',
    'expo-image',
    'expo-secure-store',
    'expo-sharing',
    'expo-tracking-transparency',
    'expo-web-browser',
    '@react-native-vector-icons/ionicons',
    '@react-native-vector-icons/fontawesome',
    '@react-native-vector-icons/feather',
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#000000',
        defaultChannel: 'orders',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'Allow the app to access your camera for QR scans and checkout identity verification.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // The Fabric focus ownership patch must be compiled into ReactAndroid.
          // Maven's prebuilt library does not include repository C++ patches.
          buildReactNativeFromSource: true,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: '36.0.0',
          // Compress native libraries in Play-generated splits. Some Android
          // 11/Huawei installs report an incorrect nativeLibraryDir while
          // using direct APK loading, so extracted libraries give SoLoader a
          // reliable ABI-specific filesystem path for libc++_shared.so.
          useLegacyPackaging: true,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // AGP 9.1 enables this by default. Keep the same DEX compaction on
          // Expo's AGP 8.12 toolchain without forcing an unsupported upgrade.
          extraProguardRules:
            '-repackageclasses\n-keep class com.google.android.gms.internal.consent_sdk.** { *; }',
        },
        ios: {
          deploymentTarget: '16.4',
          useFrameworks: 'static',
          // Keep Expo consumers and their JSI provider on the same native ABI.
          usePrecompiledModules: false,
        },
      },
    ],
    ...(tiktokBusinessPlugin ? [tiktokBusinessPlugin] : []),
    ...(googleMobileAdsPlugin ? [googleMobileAdsPlugin] : []),
    './config/withFirebaseModularHeaders.js',
    './config/withObjCLinkerFlag.js',
    './config/withNoSplashImage.js',
    './config/withAdaptiveAndroidManifest.js',
    './config/withAndroidSystemBars.js',
    './config/withAndroidGradleFixes.js',
    ...(sentryPlugin ? [sentryPlugin] : []),
    [
      'posthog-react-native/expo',
      {
        uploadNativeSymbols: true,
      },
    ],
    './config/withPostHogXcodeCliPath.js',
    'expo-localization',
    'expo-apple-authentication',
    ...(facebookSdkPlugin ? [facebookSdkPlugin] : []),
  ];
}

module.exports = { createExpoPlugins };
