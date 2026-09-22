/**
 * Expo Config Plugin: iOS Release Hardening
 *
 * Patches generated iOS project files after `expo prebuild` to ensure
 * production-ready settings that survive `expo prebuild --clean`.
 *
 * Fixes: APNs entitlements, code signing, Info.plist cleanup,
 * privacy manifest, local network description.
 */

import {
  type ConfigPlugin,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} from 'expo/config-plugins';

interface HardeningOptions {
  /** Apple Development Team ID (default: from EXPO_APPLE_TEAM_ID env var) */
  teamId?: string;
  /** Minimum iOS version (default: '16.4') */
  minimumOSVersion?: string;
  /** Production-facing local network usage description */
  localNetworkUsageDescription?: string;
}

const withIosReleaseHardening: ConfigPlugin<HardeningOptions | undefined> = (
  config,
  options = {}
) => {
  const {
    teamId = process.env.EXPO_APPLE_TEAM_ID,
    minimumOSVersion = '16.4',
    localNetworkUsageDescription = 'This app uses the local network to communicate with nearby devices for sharing and printing.',
  } = options ?? {};
  let nextConfig = config;

  // 1. Entitlements: Set APNs environment based on build config
  nextConfig = withEntitlementsPlist(nextConfig, (mod) => {
    // Use 'development' for debug/simulator builds, 'production' for release
    const isDebug =
      process.env.EAS_BUILD_PROFILE === 'development' ||
      process.env.DEBUG === '1';
    mod.modResults['aps-environment'] = isDebug ? 'development' : 'production';
    return mod;
  });

  // 2. Info.plist cleanup
  nextConfig = withInfoPlist(nextConfig, (mod) => {
    const plist = mod.modResults;

    // Replace LSMinimumSystemVersion with MinimumOSVersion
    if ('LSMinimumSystemVersion' in plist) {
      delete plist.LSMinimumSystemVersion;
    }
    plist.MinimumOSVersion = minimumOSVersion;

    // Production local network description
    plist.NSLocalNetworkUsageDescription = localNetworkUsageDescription;

    // Remove PortraitUpsideDown from iPhone orientations
    const orientations = plist.UISupportedInterfaceOrientations;
    if (Array.isArray(orientations)) {
      plist.UISupportedInterfaceOrientations = orientations.filter(
        (o: string) => o !== 'UIInterfaceOrientationPortraitUpsideDown'
      );
    }

    return mod;
  });

  // 3. Xcode project: signing, team
  nextConfig = withXcodeProject(nextConfig, (mod) => {
    const project = mod.modResults;
    const configurations = project.pbxXCBuildConfigurationSection?.();

    if (configurations) {
      for (const key of Object.keys(configurations)) {
        const buildSettings = configurations[key]?.buildSettings;
        if (!buildSettings) continue;

        // Note: LIBRARY_SEARCH_PATHS is managed by Expo/RN prebuild.
        // Do not modify it here — the xcode npm pbxproj parser cannot
        // re-parse $() variable references after writeSync, breaking
        // downstream mods like withEntitlementsPlist.

        // Set deployment target to match Info.plist MinimumOSVersion
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = minimumOSVersion;

        // Set team ID if provided
        if (teamId) {
          buildSettings.DEVELOPMENT_TEAM = teamId;
        }

        // Release-specific: use Apple Distribution signing
        const configName = configurations[key]?.name;
        if (configName === 'Release') {
          buildSettings.CODE_SIGN_IDENTITY = '"Apple Distribution"';
        }
      }
    }

    return mod;
  });

  return nextConfig;
};

export default withIosReleaseHardening;
