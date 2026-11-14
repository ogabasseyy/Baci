'use client';

// Async glue between the interaction core and its hosts. Lookup and submit
// are injected (the hook never fetches); storage, clock, and nonce default
// to the tab store, Date.now, and randomUUID with null-safe behavior.
// Generations supersede stale responses: only the latest request per input
// set may apply, and superseding never undoes server effects.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  applyOxygenDismiss,
  clearAllOxygenHandoffMarkers,
  clearOxygenHandoffMarker,
  generateOxygenNonce,
  getOxygenInteractionActions,
  idleInteractionSnapshot,
  mapOxygenSubmitNetworkFailure,
  mapOxygenSubmitResult,
  type OxygenFailedRecovery,
  type OxygenHandoffPayload,
  type OxygenInteractionLookup,
  type OxygenInteractionReason,
  type OxygenInteractionSessionStatus,
  type OxygenInteractionSnapshot,
  type OxygenInteractionState,
  type OxygenInteractionSubmit,
  type OxygenMarkerStorage,
  type OxygenSubmitResult,
  writeOxygenHandoffMarker,
} from '@/lib/payments/oxygen/interaction';
import { startOxygenInteractionLookup } from './oxygen-interaction-lookup';

export interface UseOxygenInteractionOptions {
  orderId: string | null;
  // Hosts must notifySessionEvent on identity changes that preserve status.
  session: { status: OxygenInteractionSessionStatus };
  lookup: OxygenInteractionLookup;
  submit: OxygenInteractionSubmit;
  storage?: OxygenMarkerStorage | null;
  now?: () => number;
  generateNonce?: () => string;
  onSecureFormRequest: (payload: OxygenHandoffPayload) => void;
}

export interface UseOxygenInteractionValue {
  state: OxygenInteractionState;
  reason?: OxygenInteractionReason;
  recoveries: OxygenFailedRecovery[];
  onSignin: () => void;
  onRecheck: () => void;
  onSubmit: () => void;
  onDismiss: () => void;
  notifySessionEvent: () => void;
}

const MALFORMED_REQUEST_MESSAGE =
  '[oxygen] interaction request rejected as malformed (400); verify the orderId prop';
// Fixed strings only: rejection reasons never surface, and must carry no ids.
const SYNC_SUBMIT_MESSAGE = '[oxygen] interaction submit threw synchronously';

// Hosts own sign-in navigation. This no-op has no reactive inputs.
function onSignin(): void {
  // Navigation is deliberately host-owned.
}

function defaultMarkerStorage(): OxygenMarkerStorage | null {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.sessionStorage !== 'undefined'
    ) {
      return window.sessionStorage;
    }
  } catch {
    // Storage access failed; the flow continues without a marker.
  }
  return null;
}

export function useOxygenInteraction({
  orderId,
  session,
  lookup,
  submit,
  storage = defaultMarkerStorage(),
  now = () => Date.now(),
  generateNonce = generateOxygenNonce,
  onSecureFormRequest,
}: UseOxygenInteractionOptions): UseOxygenInteractionValue {
  const [snapshot, setSnapshot] = useState<OxygenInteractionSnapshot>(() =>
    idleInteractionSnapshot()
  );

  const generationRef = useRef(0);
  const submitInflightRef = useRef(false);
  const handoffFiredForGenerationRef = useRef(-1);
  const prevSessionStatusRef = useRef(session.status);
  const hadAuthenticatedSessionRef = useRef(session.status === 'authenticated');

  const liveRef = useRef({
    orderId,
    sessionStatus: session.status,
    lookup,
    submit,
    storage,
    now,
    generateNonce,
    onSecureFormRequest,
  });
  liveRef.current = {
    orderId,
    sessionStatus: session.status,
    lookup,
    submit,
    storage,
    now,
    generateNonce,
    onSecureFormRequest,
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const startLookup = () =>
    startOxygenInteractionLookup({
      liveRef,
      generationRef,
      submitInflightRef,
      snapshotRef,
      setSnapshot,
    });

  const onSubmit = () => {
    const live = liveRef.current;
    const currentOrderId = live.orderId;
    if (currentOrderId === null || live.sessionStatus === 'loading') return;
    if (
      !getOxygenInteractionActions(snapshotRef.current).includes('submit') ||
      submitInflightRef.current
    ) {
      return;
    }
    submitInflightRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let nonce: string;
    try {
      nonce = live.generateNonce();
    } catch {
      // The attempt never started, so fail it exactly like a submit
      // network failure and leave submits unblocked for the retry.
      submitInflightRef.current = false;
      setSnapshot(mapOxygenSubmitNetworkFailure().snapshot);
      return;
    }
    setSnapshot({ state: 'initiating', recoveries: [] });
    let submitted: Promise<OxygenSubmitResult>;
    try {
      submitted = live.submit({ orderId: currentOrderId, nonce });
    } catch {
      // Normalize a synchronous host throw into the rejection path so the
      // existing handler clears in-flight state and fails closed.
      submitted = Promise.reject(new Error(SYNC_SUBMIT_MESSAGE));
    }
    void submitted.then(
      (result) => {
        if (generation !== generationRef.current) return;
        submitInflightRef.current = false;
        if (snapshotRef.current.state !== 'initiating') return;
        const transition = mapOxygenSubmitResult(result);
        if (transition.clearOrderMarker) {
          clearOxygenHandoffMarker(live.storage, currentOrderId);
        }
        if (transition.logHostError) {
          console.error(MALFORMED_REQUEST_MESSAGE);
        }
        try {
          if (transition.handoff) {
            const issuedAt = live.now();
            writeOxygenHandoffMarker(live.storage, currentOrderId, issuedAt);
            if (handoffFiredForGenerationRef.current !== generation) {
              handoffFiredForGenerationRef.current = generation;
              live.onSecureFormRequest({
                orderId: currentOrderId,
                nonce,
                issuedAt,
              });
            }
          }
        } catch {
          // Keep the marker: the submit may already have been accepted.
          // Recovery only checks status; it must never auto-resubmit.
          console.error('[oxygen] secure-form handoff failed');
          setSnapshot({ state: 'failed', recoveries: ['recheck'] });
          return;
        }
        setSnapshot(transition.snapshot);
      },
      () => {
        if (generation !== generationRef.current) return;
        submitInflightRef.current = false;
        if (snapshotRef.current.state !== 'initiating') return;
        setSnapshot(mapOxygenSubmitNetworkFailure().snapshot);
      }
    );
  };

  const onRecheck = () => {
    if (!getOxygenInteractionActions(snapshotRef.current).includes('recheck')) {
      return;
    }
    startLookup();
  };

  const onDismiss = () => {
    const live = liveRef.current;
    const transition = applyOxygenDismiss(snapshotRef.current);
    if (transition.ignored) return;
    generationRef.current += 1;
    submitInflightRef.current = false;
    if (transition.clearOrderMarker && live.orderId !== null) {
      clearOxygenHandoffMarker(live.storage, live.orderId);
    }
    setSnapshot(transition.snapshot);
  };

  const notifySessionEvent = () => {
    const live = liveRef.current;
    if (live.sessionStatus === 'guest') {
      generationRef.current += 1;
      submitInflightRef.current = false;
      clearAllOxygenHandoffMarkers(live.storage);
      setSnapshot(idleInteractionSnapshot());
      return;
    }
    if (live.sessionStatus === 'authenticated') {
      startLookup();
      return;
    }
    generationRef.current += 1;
    submitInflightRef.current = false;
    setSnapshot(idleInteractionSnapshot());
  };

  const synchronizeInputs = useEffectEvent(
    (orderId: string | null, status: OxygenInteractionSessionStatus) => {
      const prevSessionStatus = prevSessionStatusRef.current;
      prevSessionStatusRef.current = status;
      if (status === 'authenticated') {
        hadAuthenticatedSessionRef.current = true;
      }
      const signedOut =
        status === 'guest' &&
        prevSessionStatus !== 'guest' &&
        hadAuthenticatedSessionRef.current;

      if (orderId === null) {
        generationRef.current += 1;
        submitInflightRef.current = false;
        if (signedOut) {
          clearAllOxygenHandoffMarkers(liveRef.current.storage);
        }
        setSnapshot(idleInteractionSnapshot());
        return;
      }
      if (status === 'loading') {
        generationRef.current += 1;
        submitInflightRef.current = false;
        setSnapshot(idleInteractionSnapshot());
        return;
      }
      if (signedOut) {
        generationRef.current += 1;
        submitInflightRef.current = false;
        clearAllOxygenHandoffMarkers(liveRef.current.storage);
        setSnapshot(idleInteractionSnapshot());
        return;
      }
      startLookup();
    }
  );

  useEffect(() => {
    synchronizeInputs(orderId, session.status);
    return () => {
      generationRef.current += 1;
      submitInflightRef.current = false;
    };
  }, [orderId, session.status]);

  return {
    state: snapshot.state,
    reason: snapshot.reason,
    recoveries: snapshot.recoveries,
    onSignin,
    onRecheck,
    onSubmit,
    onDismiss,
    notifySessionEvent,
  };
}
