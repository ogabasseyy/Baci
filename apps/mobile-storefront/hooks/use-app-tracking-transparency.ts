import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  isDenialUnrecorded,
  recordAttLifecycleEvent,
} from '@/hooks/att-lifecycle';
import {
  canRequestTrackingTransparency,
  getTrackingPermissionStatus,
} from '@/lib/tracking-transparency';
import { requestTrackingPermission } from '@/services/ad-tracking';
import { gatherConsentBeforeTracking } from '@/services/consent-before-tracking';

interface UseAppTrackingTransparencyOptions {
  enabled: boolean;
  /** Show our explainer screen and wait for Continue before Apple's prompt. */
  explainFirst?: boolean;
}

interface UseAppTrackingTransparencyResult {
  isTrackingAuthorizationSettled: boolean;
  explainer: {
    visible: boolean;
    onContinue: () => void;
    onDismiss: () => void;
  };
}

// Lets the native launch animation finish fading before the explainer shows.
export const TRACKING_EXPLAINER_DELAY_MS = 1000;
// Safety net if a platform/test harness does not emit Modal.onDismiss.
export const MODAL_DISMISS_FALLBACK_MS = 500;

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

export function useAppTrackingTransparency({
  enabled,
  explainFirst = false,
}: UseAppTrackingTransparencyOptions): UseAppTrackingTransparencyResult {
  const [isTrackingAuthorizationSettled, setIsTrackingAuthorizationSettled] =
    useState(() => !canRequestTrackingTransparency());
  const [explainerVisible, setExplainerVisible] = useState(false);
  const continueRef = useRef<(() => void) | null>(null);
  const dismissRef = useRef<(() => void) | null>(null);
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
    let explainerTimeout: ReturnType<typeof setTimeout> | null = null;
    let explainerDismissTimeout: ReturnType<typeof setTimeout> | null = null;
    let resolveExplainerWait: (() => void) | null = null;

    // Apple's prompt only follows the shopper's own tap on Continue and the
    // native Modal's dismissal completion: it never covers the launch
    // animation, and iOS cannot discard or collide with a still-dismissing VC.
    const waitForContinue = () =>
      new Promise<void>((resolve) => {
        resolveExplainerWait = () => {
          resolveExplainerWait = null;
          dismissRef.current = null;
          if (explainerDismissTimeout) {
            clearTimeout(explainerDismissTimeout);
            explainerDismissTimeout = null;
          }
          resolve();
        };

        explainerTimeout = setTimeout(() => {
          explainerTimeout = null;
          if (cancelled) {
            resolveExplainerWait?.();
            return;
          }
          continueRef.current = () => {
            continueRef.current = null;
            setExplainerVisible(false);
            recordAttLifecycleEvent(
              'ATT Explainer Continued',
              'att:explainer_continued'
            );
            dismissRef.current = () => {
              resolveExplainerWait?.();
            };
            explainerDismissTimeout = setTimeout(() => {
              explainerDismissTimeout = null;
              resolveExplainerWait?.();
            }, MODAL_DISMISS_FALLBACK_MS);
          };
          setExplainerVisible(true);
          recordAttLifecycleEvent('ATT Explainer Shown', 'att:explainer_shown');
        }, TRACKING_EXPLAINER_DELAY_MS);
      });

    const settle = () => {
      if (!cancelled) {
        setIsTrackingAuthorizationSettled(true);
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

        // Apple ATT guidelines forbid auto-skipping or timing out a pre-prompt;
        // once shown, this intentionally remains gated until the shopper taps
        // Continue (surviving background/foreground transitions) or the hook unmounts.
        if (explainFirst) {
          await waitForContinue();
          if (cancelled) return;
        }

        // Google's consent message carries the explainer for this prompt,
        // so it goes first. Only a shopper who has not decided yet waits on
        // it, and it never rejects or hangs: whatever the outcome, the
        // request below still runs through the active-state and retry path.
        const appStateBeforeConsent = AppState.currentState ?? 'unknown';
        const consentOutcome = await gatherConsentBeforeTracking();
        if (cancelled) return;
        if (consentOutcome !== 'skipped') {
          recordAttLifecycleEvent('ATT Consent Gate', 'att:consent_gate', {
            outcome: consentOutcome,
            appStateBeforeConsent,
          });

          // With an IDFA message configured in AdMob, Google's consent
          // form can present Apple's prompt itself. If the shopper decided
          // there, there is nothing left to ask; a failed re-check or a
          // still-undetermined status goes on to the request below.
          try {
            const { status: statusAfterConsent } =
              await getTrackingPermissionStatus();
            if (cancelled) return;
            if (statusAfterConsent !== 'undetermined') {
              recordAttLifecycleEvent(
                'ATT Status Checked',
                'att:status_checked',
                { status: statusAfterConsent, afterConsent: 'true' }
              );
              settle();
              return;
            }
          } catch {
            if (cancelled) return;
          }
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
      if (explainerTimeout) clearTimeout(explainerTimeout);
      if (explainerDismissTimeout) clearTimeout(explainerDismissTimeout);
      continueRef.current = null;
      dismissRef.current = null;
      setExplainerVisible(false);
      resolveExplainerWait?.();
    };
  }, [enabled, explainFirst, isTrackingAuthorizationSettled]);

  return {
    isTrackingAuthorizationSettled,
    explainer: {
      visible: explainerVisible,
      onContinue: () => continueRef.current?.(),
      onDismiss: () => dismissRef.current?.(),
    },
  };
}
