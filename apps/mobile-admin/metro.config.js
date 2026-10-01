const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { getPostHogExpoConfig } = require('posthog-react-native/metro');

/**
 * Metro Configuration for Expo SDK 54+ Monorepo (2026 Elite Standard)
 *
 * Modified to explicitly handle resolution for pnpm monorepos
 * where some modules might not be correctly linked in sub-packages.
 *
 * CRITICAL: blockList prevents bundling of Node.js-only modules (vite, vitest, etc)
 * which cause Hermes runtime errors with import.meta syntax.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getPostHogExpoConfig(projectRoot, { getDefaultConfig });

const { transformer, resolver } = config;

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

// Configure SVG support
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.watchFolders = [
  projectRoot,
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'packages/shared'),
  path.resolve(workspaceRoot, 'packages/tiktok-business'),
];

// Prevent Metro from bundling test files and Node.js-only modules.
// This resolves Hermes errors with vite/vitest pulling in import.meta syntax.
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
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
  // 2026: Enable package exports as very new versions of native modules often require it
  unstable_enablePackageExports: true,
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
    // Node.js-only modules that cause Hermes errors
    // vite and vitest are dev-only and shouldn't be in the bundle anyway
    /node_modules[\\/]vite[\\/]/,
    /node_modules[\\/]vitest[\\/]/,
    /node_modules[\\/]@vitejs[\\/]/,
    // Other Node.js-only modules commonly pulled by build tools
    /node_modules[\\/]esbuild[\\/]/,
  ],
};

module.exports = config;
