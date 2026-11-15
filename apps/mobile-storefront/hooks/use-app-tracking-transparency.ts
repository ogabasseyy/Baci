import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import {
  canRequestTrackingTransparency,
  getTrackingPermissionStatus,
} from '@/lib/tracking-transparency';
import { requestTrackingPermission } from '@/services/ad-tracking';
import { trackEvent } from '@/services/analytics';
import { gatherConsentBeforeTracking } from '@/services/consent-before-tracking';

interface UseAppTrackingTransparencyOptions {
  enabled: boolean;
}

interface UseAppTrackingTransparencyResult {
  isTrackingAuthorizationSettled: boolean;
}

// iOS silently completes an ATT request with 'denied' WITHOUT recording a
// decision when the request lands outside a fully-active UIKit state (e.g.
// during the launch transition) — the dialog never displays, the status stays
// 'undetermined', and every later launch repeats the silent denial. Prod
// telemetry for 2.1.512-517 shows exactly this on Apple's review devices:
// 'undetermined' → request → 'denied' within 1ms, never recorded. The
// recovery below retries on a later tick; it is bounded because a missing
// native module produces the same signature indefinitely.
const MAX_UNRECORDED_DENIAL_RETRIES = 3;
const UNRECORDED_DENIAL_RETRY_BASE_DELAY_MS = 800;

function recordAttLifecycleEvent(
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

export function useAppTrackingTransparency({
  enabled,
}: UseAppTrackingTransparencyOptions): UseAppTrackingTransparencyResult {
  const [isTrackingAuthorizationSettled, setIsTrackingAuthorizationSettled] =
    useState(() => !canRequestTrackingTransparency());
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (
      !enabled ||
      isTrackingAuthorizationSettled ||
      hasStartedRef.current ||
      !canRequestTrackingTransparency()
    ) {
      return;
    }

    hasStartedRef.current = true;
    let cancelled = false;
    let appStateSubscription: ReturnType<
      typeof AppState.addEventListener
    > | null = null;
    let unrecordedDenialRetryTimeout: ReturnType<typeof setTimeout> | null =
      null;
    let unrecordedDenialRetries = 0;

    const settle = () => {
      if (!cancelled) {
        setIsTrackingAuthorizationSettled(true);
      }
    };

    // A user's real denial is recorded by iOS; a still-'undetermined' status
    // right after a 'denied' result means the dialog never showed. null =
    // the recheck itself failed and the truth is unknown.
    const isDenialUnrecorded = async (): Promise<boolean | null> => {
      try {
        const recheck = await getTrackingPermissionStatus();
        return recheck.status === 'undetermined';
      } catch {
        return null;
      }
    };

    const requestAuthorization = async () => {
      if (cancelled) return;

      recordAttLifecycleEvent('ATT Request Started', 'att:request_started');

      let status: string;
      try {
        status = await requestTrackingPermission();
      } catch {
        if (cancelled) return;
        recordAttLifecycleEvent('ATT Request Error', 'att:request_error', {
          stage: 'request',
        });
        settle();
        return;
      }
      if (cancelled) return;

      let deniedRecordedTag: string | null = null;
      if (status === 'denied') {
        const unrecorded = await isDenialUnrecorded();
        if (cancelled) return;

        if (
          unrecorded === true &&
          unrecordedDenialRetries < MAX_UNRECORDED_DENIAL_RETRIES
        ) {
          unrecordedDenialRetries += 1;
          recordAttLifecycleEvent(
            'ATT Request Unrecorded',
            'att:request_unrecorded',
            { attempt: String(unrecordedDenialRetries) }
          );
          unrecordedDenialRetryTimeout = setTimeout(() => {
            unrecordedDenialRetryTimeout = null;
            requestWhenActive();
          }, UNRECORDED_DENIAL_RETRY_BASE_DELAY_MS * unrecordedDenialRetries);
          return;
        }

        // Production dashboards must be able to tell a user's real denial
        // from an exhausted silent one — the Result event is the evidence
        // stream for the App Store resubmission.
        deniedRecordedTag =
          unrecorded === null ? 'unknown' : unrecorded ? 'false' : 'true';
      }

      recordAttLifecycleEvent('ATT Request Result', 'att:request_result', {
        status,
        ...(deniedRecordedTag !== null ? { recorded: deniedRecordedTag } : {}),
      });
      settle();
    };

    const requestWhenActive = () => {
      if (cancelled) return;
      if (AppState.currentState === 'active') {
        void requestAuthorization();
        return;
      }

      appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;
        appStateSubscription?.remove();
        appStateSubscription = null;
        void requestAuthorization();
      });
    };

    const checkStatus = async () => {
      try {
        const { status } = await getTrackingPermissionStatus();
        if (cancelled) return;
        recordAttLifecycleEvent('ATT Status Checked', 'att:status_checked', {
          status,
        });

        if (status !== 'undetermined') {
          settle();
          return;
        }

        // Google's consent message carries the explainer for this prompt,
        // so it goes first. Only a shopper who has not decided yet waits on
        // it, and it never rejects or hangs: whatever the outcome, the
        // request below still runs through the active-state and retry path.
        const appStateBeforeConsent = AppState.currentState;
        const consentOutcome = await gatherConsentBeforeTracking();
        if (cancelled) return;
        if (consentOutcome !== 'skipped') {
          recordAttLifecycleEvent('ATT Consent Gate', 'att:consent_gate', {
            outcome: consentOutcome,
            appStateBeforeConsent,
          });
        }

        requestWhenActive();
      } catch {
        if (cancelled) return;
        recordAttLifecycleEvent('ATT Request Error', 'att:request_error', {
          stage: 'status',
        });
        settle();
      }
    };

    void checkStatus();

    return () => {
      cancelled = true;
      hasStartedRef.current = false;
      appStateSubscription?.remove();
      if (unrecordedDenialRetryTimeout) {
        clearTimeout(unrecordedDenialRetryTimeout);
      }
    };
  }, [enabled, isTrackingAuthorizationSettled]);

  return { isTrackingAuthorizationSettled };
}
