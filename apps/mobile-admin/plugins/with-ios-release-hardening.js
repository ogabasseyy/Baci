const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const EXPO_MODULES_CORE_CONCURRENCY_MARKER =
  '# Added by with-ios-release-hardening (ExpoModulesCore concurrency)';

const EXPO_MODULES_CORE_CONCURRENCY_BLOCK = `    ${EXPO_MODULES_CORE_CONCURRENCY_MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if target.name == 'ExpoModulesCore'
          # Xcode 26 enforces complete Swift concurrency checking, which turns a
          # data-race diagnostic in EventEmitter.swift into a build error.
          # Third-party code that compiled cleanly under earlier toolchains;
          # restore minimal checking for this pod only.
          config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        end
      end
    end
`;

/**
 * Resolve a path guaranteed to stay inside the project root.
 */
function safeProjectPath(projectRoot, ...segments) {
  const resolvedRoot = path.resolve(projectRoot);
  const targetPath = path.resolve(resolvedRoot, ...segments);

  if (
    !targetPath.startsWith(resolvedRoot + path.sep) &&
    targetPath !== resolvedRoot
  ) {
    throw new Error(
      `Path traversal detected: ${targetPath} is outside project root`
    );
  }

  return targetPath;
}

function upsertExpoModulesCoreConcurrency(podfileContent) {
  if (podfileContent.includes(EXPO_MODULES_CORE_CONCURRENCY_MARKER)) {
    return podfileContent;
  }

  return podfileContent.replace(
    /post_install do \|installer\|/,
    `post_install do |installer|\n${EXPO_MODULES_CORE_CONCURRENCY_BLOCK}`
  );
}

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

  nextConfig = withDangerousMod(nextConfig, [
    'ios',
    (mod) => {
      const podfilePath = safeProjectPath(
        mod.modRequest.projectRoot,
        'ios',
        'Podfile'
      );
      const podfileContent = fs.readFileSync(podfilePath, 'utf8');
      fs.writeFileSync(
        podfilePath,
        upsertExpoModulesCoreConcurrency(podfileContent)
      );
      return mod;
    },
  ]);

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
