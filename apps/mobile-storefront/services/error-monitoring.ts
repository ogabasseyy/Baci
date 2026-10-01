import * as Sentry from '@sentry/react-native';
import { installMemoryWarningDiagnostics } from '@/lib/memory-warning-diagnostics';

let initialized = false;

const bundledDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const bundledEnvironment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;

export function initializeErrorMonitoring(
  env?: Readonly<Record<string, string | undefined>>
): boolean {
  installMemoryWarningDiagnostics();

  const dsn = (env?.EXPO_PUBLIC_SENTRY_DSN ?? bundledDsn)?.trim();
  if (!dsn || initialized) {
    return false;
  }

  Sentry.init({
    attachScreenshot: false,
    attachThreads: true,
    debug: typeof __DEV__ !== 'undefined' && __DEV__,
    dsn,
    enableAnrFingerprinting: true,
    enableAutoPerformanceTracing: false,
    enableAutoSessionTracking: true,
    enableHistoricalTombstoneReporting: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableTombstone: true,
    environment:
      (env?.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? bundledEnvironment)?.trim() ||
      'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  initialized = true;
  return true;
}
