function isSentryConfigurationRequired(env) {
  const isContinuousIntegration = env.CI === 'true' || env.CI === '1';

  return (
    env.EAS_BUILD === 'true' ||
    env.NODE_ENV === 'production' ||
    (isContinuousIntegration && env.NODE_ENV !== 'test')
  );
}

module.exports = { isSentryConfigurationRequired };
