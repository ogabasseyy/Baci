const { withAndroidStyles, withMainActivity } = require('@expo/config-plugins');
const {
  removeGeneratedContents,
} = require('@expo/config-plugins/build/utils/generateCode');

module.exports = function withSplashMotionWindowBackground(config) {
  const splashMotionConfig = withMainActivity(config, (innerConfig) => {
    // SplashMotion installs in onActivityPreCreated on Android 10+. Expo's
    // later registration replaces its exit listener and stalls playback.
    const source = innerConfig.modResults.contents;
    const withoutExpoSplash = removeGeneratedContents(
      source,
      'expo-splashscreen'
    );
    if (withoutExpoSplash === null) {
      // The splash-screen plugin is intentionally absent from this app. A
      // clean prebuild may therefore have nothing to remove. Still fail if a
      // registration remains, since it would replace SplashMotion ownership.
      if (source.includes('SplashScreenManager')) {
        throw new Error(
          'Expo SplashScreenManager registration remains without a generated block.'
        );
      }
      return innerConfig;
    }

    const withoutSplashManagerImport = withoutExpoSplash.replace(
      /^import expo\.modules\.splashscreen\.SplashScreenManager;?\r?\n/m,
      ''
    );
    if (withoutSplashManagerImport.includes('SplashScreenManager')) {
      throw new Error(
        'Expo SplashScreenManager registration remains after removing its generated block.'
      );
    }
    innerConfig.modResults.contents = withoutSplashManagerImport;
    return innerConfig;
  });

  return withAndroidStyles(splashMotionConfig, (innerConfig) => {
    const styles = innerConfig.modResults.resources.style ?? [];
    const appTheme = styles.find((style) => style.$.name === 'AppTheme');
    if (!appTheme) {
      throw new Error(
        'AppTheme was not found while configuring the SplashMotion window background.'
      );
    }

    appTheme.item ??= [];
    const name = 'android:windowBackground';
    const item = appTheme.item.find((entry) => entry.$.name === name);
    if (item) item._ = '@color/splashmotion_background';
    else
      appTheme.item.push({
        $: { name },
        _: '@color/splashmotion_background',
      });
    return innerConfig;
  });
};
