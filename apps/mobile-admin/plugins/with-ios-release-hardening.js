const {
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const withIosReleaseHardening = (config, options = {}) => {
  const {
    teamId = process.env.EXPO_APPLE_TEAM_ID,
    minimumOSVersion = '16.4',
    localNetworkUsageDescription = 'This app uses the local network to communicate with nearby devices for sharing and printing.',
  } = options ?? {};
  let nextConfig = config;

  nextConfig = withEntitlementsPlist(nextConfig, (mod) => {
    const isDebug =
      process.env.EAS_BUILD_PROFILE === 'development' ||
      process.env.DEBUG === '1';
    mod.modResults['aps-environment'] = isDebug ? 'development' : 'production';
    return mod;
  });

  nextConfig = withInfoPlist(nextConfig, (mod) => {
    const plist = mod.modResults;

    if ('LSMinimumSystemVersion' in plist) {
      delete plist.LSMinimumSystemVersion;
    }

    plist.MinimumOSVersion = minimumOSVersion;
    plist.NSLocalNetworkUsageDescription = localNetworkUsageDescription;

    const orientations = plist.UISupportedInterfaceOrientations;
    if (Array.isArray(orientations)) {
      plist.UISupportedInterfaceOrientations = orientations.filter(
        (orientation) =>
          orientation !== 'UIInterfaceOrientationPortraitUpsideDown'
      );
    }

    return mod;
  });

  nextConfig = withXcodeProject(nextConfig, (mod) => {
    const project = mod.modResults;
    const configurations = project.pbxXCBuildConfigurationSection?.();

    if (configurations) {
      for (const key of Object.keys(configurations)) {
        const buildSettings = configurations[key]?.buildSettings;
        if (!buildSettings) continue;

        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = minimumOSVersion;

        if (teamId) {
          buildSettings.DEVELOPMENT_TEAM = teamId;
        }

        if (configurations[key]?.name === 'Release') {
          buildSettings.CODE_SIGN_IDENTITY = '"Apple Distribution"';
        }
      }
    }

    return mod;
  });

  return nextConfig;
};

module.exports = withIosReleaseHardening;
module.exports.default = withIosReleaseHardening;
