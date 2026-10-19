import * as Sentry from '@sentry/react-native';
import { installMemoryWarningDiagnostics } from '@/lib/memory-warning-diagnostics';

let initialized = false;

const bundledDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const bundledEnvironment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
const bundledBuildSha = process.env.EXPO_PUBLIC_BUILD_SHA;

export function initializeErrorMonitoring(
  env?: Readonly<Record<string, string | undefined>>
): boolean {
  installMemoryWarningDiagnostics();

  const dsn = (env?.EXPO_PUBLIC_SENTRY_DSN ?? bundledDsn)?.trim();
  if (!dsn || initialized) {
    return false;
  }

  const buildSha = (env?.EXPO_PUBLIC_BUILD_SHA ?? bundledBuildSha)?.trim();
  const nativeOptions = (
    globalThis as typeof globalThis & { __SENTRY_OPTIONS__?: unknown }
  ).__SENTRY_OPTIONS__;
  Sentry.init({
    attachScreenshot: false,
    attachThreads: true,
    debug: typeof __DEV__ !== 'undefined' && __DEV__,
    dsn,
    enableAnrFingerprinting: true,
    enableAutoPerformanceTracing: true,
    enableAutoSessionTracking: true,
    enableHistoricalTombstoneReporting: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    // Expo's options prelude means native startup owns the SDK. Preserve its
    // breadcrumb/MetricKit callback in development too, where Sentry otherwise
    // reinitializes from JS and replaces the native options.
    ...(nativeOptions && typeof nativeOptions === 'object'
      ? { autoInitializeNativeSdk: false }
      : {}),
    enableTombstone: true,
    // Receipt capabilities and address/session queries must never enter network
    // spans or breadcrumbs. Keep native frame and explicit surface tracing.
    integrations: [
      Sentry.reactNativeTracingIntegration({
        traceFetch: false,
        traceXHR: false,
      }),
    ],
    beforeBreadcrumb: (breadcrumb) =>
      ['http', 'fetch', 'xhr'].includes(breadcrumb.category ?? '')
        ? null
        : breadcrumb,
    environment:
      (env?.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? bundledEnvironment)?.trim() ||
      'production',
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    ...(/^[a-f0-9]{40}$/.test(buildSha ?? '')
      ? { initialScope: { tags: { build_sha: buildSha } } }
      : {}),
  });
  initialized = true;
  return true;
}
