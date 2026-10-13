import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInit = jest.fn();
const mockTracingIntegration = jest.fn(() => ({ name: 'ReactNativeTracing' }));
const mockInstallMemoryWarningDiagnostics = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: mockInit,
  reactNativeTracingIntegration: mockTracingIntegration,
}));

jest.mock('@/lib/memory-warning-diagnostics', () => ({
  installMemoryWarningDiagnostics: mockInstallMemoryWarningDiagnostics,
}));

describe('initializeErrorMonitoring', () => {
  beforeEach(() => {
    jest.resetModules();
    mockInit.mockClear();
    mockTracingIntegration.mockClear();
    mockInstallMemoryWarningDiagnostics.mockClear();
  });

  it('excludes capability tokens and address queries from network telemetry', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );
    initializeErrorMonitoring({
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
    });
    expect(mockTracingIntegration).toHaveBeenCalledWith({
      traceFetch: false,
      traceXHR: false,
    });
    const options = mockInit.mock.calls[0]?.[0] as {
      beforeBreadcrumb: (breadcrumb: {
        category: string;
        data?: { url: string };
      }) => unknown;
    };
    for (const category of ['http', 'fetch', 'xhr']) {
      for (const url of [
        'https://usebaci.com/api/storefront/receipts/claims/private-capability',
        'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=private-address&sessionToken=private-session',
      ]) {
        expect(
          options.beforeBreadcrumb({ category, data: { url } })
        ).toBeNull();
      }
    }
    const route = { category: 'app.route' };
    expect(options.beforeBreadcrumb(route)).toBe(route);
  });

  it('initializes native ANR and crash capture without collecting PII', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );

    expect(
      initializeErrorMonitoring({
        EXPO_PUBLIC_SENTRY_DSN: ' https://public@example.invalid/1 ',
        EXPO_PUBLIC_SENTRY_ENVIRONMENT: ' production ',
      })
    ).toBe(true);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachScreenshot: false,
        attachThreads: true,
        dsn: 'https://public@example.invalid/1',
        enableAnrFingerprinting: true,
        enableHistoricalTombstoneReporting: true,
        enableNative: true,
        enableNativeCrashHandling: true,
        enableTombstone: true,
        environment: 'production',
        sendDefaultPii: false,
        enableAutoPerformanceTracing: true,
        tracesSampleRate: 0.05,
      })
    );
    expect(mockInstallMemoryWarningDiagnostics).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0]?.[0]).not.toHaveProperty(
      'autoInitializeNativeSdk'
    );
  });

  it('attaches the validated build revision to initial native and JS scope', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );
    const sha = 'a'.repeat(40);
    initializeErrorMonitoring({
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
      EXPO_PUBLIC_BUILD_SHA: sha,
    });
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ initialScope: { tags: { build_sha: sha } } })
    );
  });

  it('does not forward an invalid build revision', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );
    initializeErrorMonitoring({
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
      EXPO_PUBLIC_BUILD_SHA: 'token=private',
    });
    expect(mockInit.mock.calls[0]?.[0]).not.toHaveProperty('initialScope');
  });

  it('stays disabled when the public DSN is missing', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );

    expect(initializeErrorMonitoring({})).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockInstallMemoryWarningDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('initializes from the bundled Expo public environment', () => {
    const previousDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    const previousEnvironment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://bundled@example.invalid/2';
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = 'preview';

    try {
      jest.resetModules();
      const { initializeErrorMonitoring } =
        jest.requireActual<typeof import('./error-monitoring')>(
          './error-monitoring'
        );

      expect(initializeErrorMonitoring()).toBe(true);
      expect(mockInit).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://bundled@example.invalid/2',
          environment: 'preview',
        })
      );
    } finally {
      if (previousDsn === undefined) {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      } else {
        process.env.EXPO_PUBLIC_SENTRY_DSN = previousDsn;
      }
      if (previousEnvironment === undefined) {
        delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
      } else {
        process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = previousEnvironment;
      }
    }
  });

  it('initializes at most once per application process', () => {
    const { initializeErrorMonitoring } =
      jest.requireActual<typeof import('./error-monitoring')>(
        './error-monitoring'
      );
    const env = { EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1' };

    expect(initializeErrorMonitoring(env)).toBe(true);
    expect(initializeErrorMonitoring(env)).toBe(false);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});
