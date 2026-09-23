import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { initAdTracking } from './ad-tracking';

const AD_TRACKING_STARTUP_TIMEOUT_MS = 4000;

export async function initializeAdTrackingForStartup(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // The startup deadline releases the UI; it does not cancel the SDK work.
  // Observe its eventual outcome even after startup continues.
  const initialization = Promise.resolve()
    .then(() => initAdTracking())
    .then(
      () => {
        recordCrashBreadcrumb('root_layout:ad_tracking_initialized');
      },
      (error: unknown) => {
        console.error('Ad tracking initialization error:', error);
        recordCrashBreadcrumb('root_layout:ad_tracking_error', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    );

  try {
    await Promise.race([
      initialization,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          recordCrashBreadcrumb('root_layout:ad_tracking_deferred');
          resolve();
        }, AD_TRACKING_STARTUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
