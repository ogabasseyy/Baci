const { withAndroidStyles, withMainActivity } = require('@expo/config-plugins');
const {
  removeGeneratedContents,
} = require('@expo/config-plugins/build/utils/generateCode');

module.exports = function withSplashMotionWindowBackground(config) {
  const splashMotionConfig = withMainActivity(config, (innerConfig) => {
    // SplashMotion installs in onActivityPreCreated on Android 10+. Expo's
    // later registration replaces its exit listener and stalls playback.
    const source = innerConfig.modResults.contents;
    innerConfig.modResults.contents = (
      removeGeneratedContents(source, 'expo-splashscreen') ?? source
    ).replace(
      /^import expo\.modules\.splashscreen\.SplashScreenManager;?\r?\n/m,
      ''
    );
    return innerConfig;
  });

  return withAndroidStyles(splashMotionConfig, (innerConfig) => {
    const styles = innerConfig.modResults.resources.style ?? [];
    const appTheme = styles.find((style) => style.$.name === 'AppTheme');
    if (appTheme) {
      appTheme.item ??= [];
      const name = 'android:windowBackground';
      const item = appTheme.item.find((entry) => entry.$.name === name);
      if (item) item._ = '@color/splashmotion_background';
      else
        appTheme.item.push({
          $: { name },
          _: '@color/splashmotion_background',
        });
    }
    return innerConfig;
  });
};
