const { withAndroidStyles } = require('@expo/config-plugins');

module.exports = function withSplashMotionWindowBackground(config) {
  return withAndroidStyles(config, (innerConfig) => {
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
