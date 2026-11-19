const { withMod } = require('@expo/config-plugins');
const { normalizeSplashStoryboard } = require('./normalize-splash-storyboard');

module.exports = (config) =>
  withMod(config, {
    platform: 'ios',
    mod: 'splashScreenStoryboard',
    action: (innerConfig) => {
      innerConfig.modResults = normalizeSplashStoryboard(
        innerConfig.modResults
      );
      return innerConfig;
    },
  });
