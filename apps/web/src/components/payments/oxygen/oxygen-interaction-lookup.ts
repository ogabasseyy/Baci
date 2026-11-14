import {
  clearOxygenHandoffMarker,
  idleInteractionSnapshot,
  mapOxygenLookupNetworkFailure,
  mapOxygenLookupResult,
  type OxygenInteractionLookup,
  type OxygenInteractionSessionStatus,
  type OxygenInteractionSnapshot,
  type OxygenLookupResult,
  type OxygenMarkerStorage,
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  snapshotForRevalidate,
} from '@/lib/payments/oxygen/interaction';

const MALFORMED_REQUEST_MESSAGE =
  '[oxygen] interaction request rejected as malformed (400); verify the orderId prop';
const SYNC_LOOKUP_MESSAGE = '[oxygen] interaction lookup threw synchronously';

type Ref<T> = { current: T };
interface LookupContext {
  liveRef: Ref<{
    orderId: string | null;
    sessionStatus: OxygenInteractionSessionStatus;
    lookup: OxygenInteractionLookup;
    storage: OxygenMarkerStorage | null;
    now: () => number;
  }>;
  generationRef: Ref<number>;
  submitInflightRef: Ref<boolean>;
  snapshotRef: Ref<OxygenInteractionSnapshot>;
  setSnapshot: (value: OxygenInteractionSnapshot) => void;
}

export function startOxygenInteractionLookup(context: LookupContext): void {
  const live = context.liveRef.current;
  const currentOrderId = live.orderId;
  if (live.sessionStatus === 'loading') return;
  if (currentOrderId === null) {
    context.generationRef.current += 1;
    context.submitInflightRef.current = false;
    context.setSnapshot(idleInteractionSnapshot());
    return;
  }
  // Probe before validating: the core read discards invalid markers, so
  // presence must be observed first to tell "none" (check) from "invalid"
  // (idle + discard, zero fetch).
  let rawPresent = false;
  if (live.storage !== null && currentOrderId !== '') {
    try {
      rawPresent =
        live.storage.getItem(oxygenHandoffMarkerKey(currentOrderId)) !== null;
    } catch {
      rawPresent = false;
    }
  }
  const marker = readOxygenHandoffMarker(
    live.storage,
    currentOrderId,
    live.now()
  );
  const generation = context.generationRef.current + 1;
  context.generationRef.current = generation;
  context.submitInflightRef.current = false;
  if (rawPresent && marker === null) {
    context.setSnapshot(idleInteractionSnapshot());
    return;
  }
  context.setSnapshot(snapshotForRevalidate(marker !== null));
  let pending: Promise<OxygenLookupResult>;
  try {
    pending = live.lookup(currentOrderId);
  } catch {
    // A synchronously throwing host lookup normalizes into the rejection
    // path, so the existing handler fails closed instead of wedging.
    pending = Promise.reject(new Error(SYNC_LOOKUP_MESSAGE));
  }
  void pending.then(
    (result) => {
      if (generation !== context.generationRef.current) return;
      const current = context.snapshotRef.current;
      if (current.state !== 'checking' && current.state !== 'resuming') {
        return;
      }
      const transition = mapOxygenLookupResult(result, current.state);
      if (transition.clearOrderMarker) {
        clearOxygenHandoffMarker(live.storage, currentOrderId);
      }
      if (transition.logHostError) {
        console.error(MALFORMED_REQUEST_MESSAGE);
      }
      context.setSnapshot(transition.snapshot);
    },
    () => {
      if (generation !== context.generationRef.current) return;
      const current = context.snapshotRef.current;
      if (current.state !== 'checking' && current.state !== 'resuming') {
        return;
      }
      context.setSnapshot(
        mapOxygenLookupNetworkFailure(current.state).snapshot
      );
    }
  );
}
