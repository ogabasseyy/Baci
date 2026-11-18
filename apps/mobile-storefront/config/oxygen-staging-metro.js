// The existing isolated staging development client predates SplashMotion.
// Release builds must always resolve the real native module.
function resolveOxygenStagingModule(moduleName, env) {
  if (
    moduleName !== 'react-native-splash-motion' ||
    env.EXPO_PUBLIC_OXYGEN_STAGING !== '1' ||
    env.NODE_ENV !== 'development'
  ) {
    return null;
  }
  return require.resolve('./oxygen-staging-splash');
}

module.exports = { resolveOxygenStagingModule };
