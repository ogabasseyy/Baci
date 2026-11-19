// The existing isolated staging development client predates SplashMotion.
// Release builds must always resolve the real native module.
function resolveOxygenStagingModule(moduleName, env) {
  const stagingDevelopment =
    env.EXPO_PUBLIC_OXYGEN_STAGING === '1' && env.NODE_ENV === 'development';
  if (
    moduleName === '../components/oxygen-preview/entry' &&
    !stagingDevelopment
  )
    return require.resolve('./oxygen-preview-release');
  if (
    moduleName === './oxygen-bank-logos' &&
    (!stagingDevelopment || env.EAS_BUILD || env.EAS_BUILD_PROFILE || env.CI)
  )
    return require.resolve('./oxygen-bank-logos-release');
  if (moduleName === 'react-native-splash-motion' && stagingDevelopment)
    return require.resolve('./oxygen-staging-splash');
  return null;
}

module.exports = { resolveOxygenStagingModule };
