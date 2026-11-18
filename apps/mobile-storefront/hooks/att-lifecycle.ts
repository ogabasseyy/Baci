import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { getTrackingPermissionStatus } from '@/lib/tracking-transparency';
import { trackEvent } from '@/services/analytics';

/**
 * Records ATT lifecycle breadcrumbs and analytics events without letting
 * observability failures block the native permission prompt.
 */
export function recordAttLifecycleEvent(
  eventName: string,
  breadcrumbName: string,
  properties?: Record<string, string>
) {
  try {
    recordCrashBreadcrumb(breadcrumbName, properties);
  } catch {
    // Observability must never block the native permission request.
  }

  try {
    trackEvent(eventName, properties);
  } catch {
    // Analytics may not be ready when the first visible frame appears.
  }
}

/**
 * Checks whether a denied ATT result was left unrecorded ('undetermined') by iOS.
 * Returns null if the re-check itself throws.
 */
export async function isDenialUnrecorded(): Promise<boolean | null> {
  try {
    const recheck = await getTrackingPermissionStatus();
    return recheck.status === 'undetermined';
  } catch {
    return null;
  }
}
