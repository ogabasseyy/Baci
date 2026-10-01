import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInit = jest.fn();
const mockInstallMemoryWarningDiagnostics = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: mockInit,
}));

jest.mock('@/lib/memory-warning-diagnostics', () => ({
  installMemoryWarningDiagnostics: mockInstallMemoryWarningDiagnostics,
}));

describe('initializeErrorMonitoring', () => {
  beforeEach(() => {
    jest.resetModules();
    mockInit.mockClear();
    mockInstallMemoryWarningDiagnostics.mockClear();
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
        tracesSampleRate: 0,
      })
    );
    expect(mockInstallMemoryWarningDiagnostics).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0]?.[0]).not.toHaveProperty(
      'autoInitializeNativeSdk'
    );
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
