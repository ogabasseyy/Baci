const { resolveUpdateChannel } = require('./resolve-update-channel.js');
const {
  DEFAULT_APP_VERSION,
  resolveAppVersion,
} = require('./resolve-app-versions.js');

const EAS_PROJECT_ID = '4b258ae6-fc8a-4b3d-bcbe-dfb3402203c9';
const EAS_UPDATE_URL = `https://u.expo.dev/${EAS_PROJECT_ID}`;

/**
 * App-version runtime + EAS Update settings for local release prebuilds.
 * Channel is derived from env so store binaries receive production OTAs.
 */
function buildEasUpdateConfig(environment = process.env) {
  const isDevelopmentBuild =
    environment.EAS_BUILD_PROFILE?.trim() === 'development';
  const runtimeVersion = resolveAppVersion(environment) ?? DEFAULT_APP_VERSION;

  if (isDevelopmentBuild) {
    return {
      easProjectId: EAS_PROJECT_ID,
      runtimeVersion,
      updates: {
        enabled: false,
      },
    };
  }

  const updateChannel = resolveUpdateChannel(environment);

  return {
    easProjectId: EAS_PROJECT_ID,
    runtimeVersion,
    updates: {
      // Release builds check in the background at launch and keep using the
      // embedded/cached bundle immediately. A downloaded update is applied on
      // the next restart, preserving a working startup path during outages.
      checkAutomatically: 'ON_LOAD',
      enableBsdiffPatchSupport: true,
      enabled: true,
      fallbackToCacheTimeout: 0,
      requestHeaders: {
        'expo-channel-name': updateChannel,
      },
      url: EAS_UPDATE_URL,
      useEmbeddedUpdate: true,
    },
  };
}

/**
 * Keep the physical-device development client on its last working project.
 * Do not set defaultLaunchURL: LAN addresses are ephemeral and a baked-in URL
 * would be unsafe for preview/release builds.
 */
function createExpoDevClientPlugin() {
  return [
    'expo-dev-client',
    {
      launchMode: 'most-recent',
    },
  ];
}

module.exports = {
  EAS_PROJECT_ID,
  EAS_UPDATE_URL,
  buildEasUpdateConfig,
  createExpoDevClientPlugin,
};
