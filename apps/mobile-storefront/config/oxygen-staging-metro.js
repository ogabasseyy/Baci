// The existing isolated staging development client predates SplashMotion.
// Release builds must always resolve the real native module.
function resolveOxygenStagingModule(moduleName, env) {
  const stagingDevelopment =
    env.EXPO_PUBLIC_OXYGEN_STAGING === '1' && env.NODE_ENV === 'development';
  const localStaging =
    stagingDevelopment && !env.EAS_BUILD && !env.EAS_BUILD_PROFILE && !env.CI;
  // The single visual-QA entry is pinned by oxygen-staging-metro.test.mjs.
  if (
    !localStaging &&
    /(?:^|\/)oxygen-preview\/visual-qa-route(?:\.[jt]sx?)?$/.test(
      moduleName.replaceAll('\\', '/')
    )
  )
    return require.resolve('./oxygen-preview-release');
  if (moduleName === 'react-native-splash-motion' && stagingDevelopment)
    return require.resolve('./oxygen-staging-splash');
  return null;
}

module.exports = { resolveOxygenStagingModule };
