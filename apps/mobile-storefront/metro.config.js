/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { getPostHogExpoConfig } = require('posthog-react-native/metro');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const shouldEnableWorkletsBundleMode = require('./config/shouldEnableWorkletsBundleMode');

/**
 * Metro Configuration for Expo SDK 54+ Monorepo (2026 Elite Standard)
 *
 * Since Expo SDK 52, Metro automatically configures itself for monorepos.
 * We now explicitly configure watchFolders and nodeModulesPaths to ensure
 * core dependencies are resolved from the root node_modules.
 *
 * CRITICAL: blockList prevents bundling of Node.js-only modules (vite, vitest, esbuild, etc)
 * which cause Hermes runtime errors with import.meta syntax.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getPostHogExpoConfig(projectRoot, {
  getDefaultConfig: (root, options) =>
    getSentryExpoConfig(root, {
      ...options,
      autoWrapExpoRouterErrorBoundary: true,
      getDefaultConfig,
      includeWebFeedback: false,
      includeWebReplay: false,
    }),
});

const { resolver } = config;

function resolvePackageRoot(packageName) {
  const projectPackageRoot = path.resolve(
    projectRoot,
    'node_modules',
    packageName
  );

  try {
    require.resolve(path.join(projectPackageRoot, 'package.json'));
    return projectPackageRoot;
  } catch {
    return path.resolve(workspaceRoot, 'node_modules', packageName);
  }
}

const reactPackageRoot = resolvePackageRoot('react');
const reactDomPackageRoot = resolvePackageRoot('react-dom');
const reactNativePackageRoot = resolvePackageRoot('react-native');
const expoPackageRoot = resolvePackageRoot('expo');
const expoRouterPackageRoot = resolvePackageRoot('expo-router');
const gestureHandlerPackageRoot = resolvePackageRoot(
  'react-native-gesture-handler'
);
const reanimatedPackageRoot = resolvePackageRoot('react-native-reanimated');
const screensPackageRoot = resolvePackageRoot('react-native-screens');
const safeAreaContextPackageRoot = resolvePackageRoot(
  'react-native-safe-area-context'
);
const zustandMiddlewarePath = require.resolve('zustand/middleware');

config.watchFolders = [
  projectRoot,
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'packages/shared'),
  path.resolve(workspaceRoot, 'packages/tiktok-business'),
];
config.resolver = {
  ...resolver,
  nodeModulesPaths: [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ],
  // Prefer the app-local core packages first so release bundles stay version-aligned.
  extraNodeModules: {
    '@baci/shared': path.resolve(workspaceRoot, 'packages/shared'),
    'react-native': reactNativePackageRoot,
    react: reactPackageRoot,
    'react-dom': reactDomPackageRoot,
    expo: expoPackageRoot,
    'expo-router': expoRouterPackageRoot,
    'react-native-gesture-handler': gestureHandlerPackageRoot,
    'react-native-reanimated': reanimatedPackageRoot,
    'react-native-screens': screensPackageRoot,
    'react-native-safe-area-context': safeAreaContextPackageRoot,
  },
  // 2026: Enable package exports so shared-package subpath imports resolve the
  // same way in Metro as they do in the rest of the monorepo.
  unstable_enablePackageExports: true,
  resolveRequest: (context, moduleName, platform) => {
    // Expo web serves a classic script, while Zustand's ESM middleware contains import.meta.
    if (platform === 'web' && moduleName === 'zustand/middleware') {
      return {
        filePath: zustandMiddlewarePath,
        type: 'sourceFile',
      };
    }

    return context.resolveRequest(context, moduleName, platform);
  },
  blockList: [
    // Ignore massive directories to prevent "RangeError: Map maximum size exceeded"
    /[\\/]\.git[\\/]/,
    /[\\/]\.pnpm-store[\\/]/,
    /[\\/]\.next[\\/]/,
    /[\\/]\.Derived[\\/]/,
    /[\\/]\.gemini[\\/]/,
    /[\\/]\.agent[\\/]/,
    /[\\/]apps[\\/]web[\\/]node_modules[\\/]/,

    // Test files should not be bundled
    /\.test\.tsx?$/,
    /\.spec\.tsx?$/,
    /\/__tests__\//,
    // Test configuration files
    /vitest\.config\.ts$/,
    /jest\.config\.js$/,
    /jest\.setup\.ts$/,
    // Node.js-only modules that cause Hermes errors
    // vite and vitest are dev-only and shouldn't be in the bundle anyway
    /node_modules[\\/]vite[\\/]/,
    /node_modules[\\/]vitest[\\/]/,
    /node_modules[\\/]@vitejs[\\/]/,
    // Other Node.js-only modules commonly pulled by build tools
    /node_modules[\\/]esbuild[\\/]/,
  ],
};

// Worklets bundle mode must wrap the FULL config LAST when explicitly enabled:
// it composes resolver.resolveRequest, so applying it before the resolver
// assignment above would let `config.resolver = {…}` overwrite it. Default off
// while Android expo-updates OTA bundles are unsafe on SDK 57 / RN 0.86 /
// worklets 0.10.
if (shouldEnableWorkletsBundleMode()) {
  const {
    getBundleModeMetroConfig,
  } = require('react-native-worklets/bundleMode');

  module.exports = getBundleModeMetroConfig(config);
} else {
  module.exports = config;
}
