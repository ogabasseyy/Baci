import { afterEach, expect, it, jest } from '@jest/globals';

const mockCreateVerifier = jest.fn<(options: unknown) => () => Promise<void>>();

afterEach(() => {
  jest.resetModules();
  jest.dontMock('./benchmark-telemetry-check');
});

it('builds the verifier with the configured diagnostic id and Sentry environment', () => {
  const previousId = process.env.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID;
  const previousEnvironment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  process.env.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID = 'synthetic-startup-check';
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = 'benchmark';
  jest.doMock('./benchmark-telemetry-check', () => ({
    createBenchmarkTelemetryVerifier: (options: unknown) => {
      mockCreateVerifier(options);
      return jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    },
  }));

  try {
    jest.isolateModules(() => {
      require('./verify-benchmark-telemetry');
    });
    expect(mockCreateVerifier).toHaveBeenCalledWith({
      diagnosticId: 'synthetic-startup-check',
      environment: 'benchmark',
    });
  } finally {
    if (previousId === undefined)
      delete process.env.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID;
    else process.env.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID = previousId;
    if (previousEnvironment === undefined)
      delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = previousEnvironment;
  }
});
