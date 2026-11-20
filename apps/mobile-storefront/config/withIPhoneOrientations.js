const { withInfoPlist } = require('@expo/config-plugins');

module.exports = (config) =>
  withInfoPlist(config, (config) => {
    const plist = config.modResults;
    const orientations = plist.UISupportedInterfaceOrientations;
    if (Array.isArray(orientations)) {
      plist.UISupportedInterfaceOrientations = orientations.filter(
        (orientation) =>
          orientation !== 'UIInterfaceOrientationPortraitUpsideDown'
      );
    }
    return config;
  });
