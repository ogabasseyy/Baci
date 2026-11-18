import { useEffect } from 'react';
import { shouldVerifyStartupTelemetry } from '@/lib/startup-telemetry-eligibility';
import { verifyBenchmarkTelemetry } from '@/lib/verify-benchmark-telemetry';

interface StartupTelemetryReadiness {
  appInitialized: boolean;
  loaded: boolean;
  nativeIntroSettled: boolean;
  showSplash: boolean;
  storageReady: boolean;
  timedOut: boolean;
}

export function useStartupTelemetryVerification({
  appInitialized,
  loaded,
  nativeIntroSettled,
  showSplash,
  storageReady,
  timedOut,
}: StartupTelemetryReadiness) {
  useEffect(() => {
    if (
      shouldVerifyStartupTelemetry({
        appInitialized,
        loaded,
        nativeIntroSettled,
        showSplash,
        storageReady,
        timedOut,
      })
    ) {
      void verifyBenchmarkTelemetry();
    }
  }, [
    showSplash,
    timedOut,
    nativeIntroSettled,
    loaded,
    appInitialized,
    storageReady,
  ]);
}
