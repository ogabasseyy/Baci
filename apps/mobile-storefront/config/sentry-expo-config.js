const optionalValue = (value) => value?.trim() || undefined;

function buildSentryExpoConfiguration(env, { required }) {
  const dsn = optionalValue(env.EXPO_PUBLIC_SENTRY_DSN);
  const organization = optionalValue(env.SENTRY_ORG);
  const project = optionalValue(env.SENTRY_PROJECT);
  const authToken = optionalValue(env.SENTRY_AUTH_TOKEN);
  const missing = [
    ['EXPO_PUBLIC_SENTRY_DSN', dsn],
    ['SENTRY_ORG', organization],
    ['SENTRY_PROJECT', project],
    ['SENTRY_AUTH_TOKEN', authToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0 && (required || !dsn)) {
    const detail = `Missing Sentry configuration: ${missing.join(', ')}.`;
    if (required) {
      throw new Error(
        `[app.config] Missing required Sentry configuration: ${missing.join(', ')}. Native ANR capture and release symbol uploads must be configured together.`
      );
    }
    if (env.NODE_ENV === 'test') {
      return { plugin: null };
    }
    console.warn(
      `[app.config] WARNING: ${detail} Native ANR capture will be disabled for local development.`
    );
    return { plugin: null };
  }

  // Uploads need token + org + project together; a partial set still breaks
  // generated iOS/Android Sentry upload tasks on local native builds.
  const canUploadSymbols = Boolean(authToken && organization && project);

  return {
    plugin: [
      '@sentry/react-native/expo',
      {
        experimental_android: {
          enableAndroidGradlePlugin: true,
          ...(!canUploadSymbols
            ? {
                autoUploadNativeSymbols: false,
                autoUploadProguardMapping: false,
              }
            : {}),
        },
        ...(!canUploadSymbols ? { disableAutoUpload: true } : {}),
        organization,
        project,
        url: optionalValue(env.SENTRY_URL) || 'https://sentry.io/',
        useNativeInit: true,
        options: {
          attachScreenshot: false,
          attachThreads: true,
          dsn,
          enableAnrFingerprinting: true,
          enableHistoricalTombstoneReporting: true,
          enableNativeCrashHandling: true,
          enableTombstone: true,
          environment:
            optionalValue(env.EXPO_PUBLIC_SENTRY_ENVIRONMENT) ||
            (required ? 'production' : 'development'),
          sendDefaultPii: false,
        },
      },
    ],
  };
}

module.exports = { buildSentryExpoConfiguration };
