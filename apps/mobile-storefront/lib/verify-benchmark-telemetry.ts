import { createBenchmarkTelemetryVerifier } from './benchmark-telemetry-check';

export const verifyBenchmarkTelemetry = createBenchmarkTelemetryVerifier({
  diagnosticId: process.env.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
});
