import * as Sentry from '@sentry/react-native';
import { Image } from 'expo-image';
import { AppState } from 'react-native';
import { recordCrashBreadcrumb } from './crash-diagnostics';

type MemoryWarningSubscription = { remove: () => void };

let subscription: MemoryWarningSubscription | null = null;
let warningCount = 0;

function handleMemoryWarning(): void {
  warningCount += 1;
  const details = {
    app_state: AppState.currentState,
    warning_count: warningCount,
  };

  // Release decoded image buffers before doing any optional telemetry work.
  // UIKit can terminate the process after a memory warning if pressure stays
  // high; the cache is repopulated on demand by expo-image.
  try {
    void Image.clearMemoryCache().catch(() => undefined);
  } catch {
    // A missing native image module must not make a memory warning fatal.
  }

  recordCrashBreadcrumb('app:memory_warning', details);
  try {
    Sentry.addBreadcrumb({
      category: 'app.memory',
      data: details,
      level: 'warning',
      message: 'memory_warning',
    });
  } catch {
    // Diagnostics must remain best-effort while the process is under pressure.
  }
}

/**
 * Captures UIKit memory warnings in both the local bounded breadcrumb buffer
 * and Sentry's native breadcrumb store. The listener is installed before the
 * React tree starts so a startup watchdog can retain the last warning.
 */
export function installMemoryWarningDiagnostics(): () => void {
  if (subscription) return () => undefined;

  let installedSubscription: MemoryWarningSubscription;
  try {
    installedSubscription = AppState.addEventListener(
      'memoryWarning',
      handleMemoryWarning
    );
    subscription = installedSubscription;
  } catch {
    // Some non-native runtimes do not expose the memory-warning event.
    subscription = null;
    return () => undefined;
  }

  return () => {
    if (subscription !== installedSubscription) return;
    try {
      installedSubscription.remove();
    } finally {
      subscription = null;
      warningCount = 0;
    }
  };
}
