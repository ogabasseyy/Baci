import type {
  OxygenHandoffMarker,
  OxygenMarkerStorage,
} from './interaction-types';

export const OXYGEN_HANDOFF_MARKER_PREFIX = 'baci_oxygen_handoff:';
export const OXYGEN_HANDOFF_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

export function oxygenHandoffMarkerKey(orderId: string): string {
  return `${OXYGEN_HANDOFF_MARKER_PREFIX}${orderId}`;
}

function discardMarker(storage: OxygenMarkerStorage, orderId: string): void {
  try {
    storage.removeItem(oxygenHandoffMarkerKey(orderId));
  } catch {
    // Storage failures must never break the payment flow.
  }
}

// Non-authoritative UX hint only: even a valid marker always triggers a
// server GET, never skips revalidation. Last-write-wins across tabs.
export function writeOxygenHandoffMarker(
  storage: OxygenMarkerStorage | null,
  orderId: string,
  now: number
): void {
  if (storage === null || orderId === '') return;
  try {
    storage.setItem(
      oxygenHandoffMarkerKey(orderId),
      JSON.stringify({ orderId, createdAt: now })
    );
  } catch {
    // Quota or access denial: the flow continues without a marker.
  }
}

// Reads and validates. A present-but-invalid marker (corrupt, mismatched,
// or TTL-expired) is discarded so resume never retries junk.
export function readOxygenHandoffMarker(
  storage: OxygenMarkerStorage | null,
  orderId: string,
  now: number
): OxygenHandoffMarker | null {
  if (storage === null || orderId === '') return null;
  let raw: string | null;
  try {
    raw = storage.getItem(oxygenHandoffMarkerKey(orderId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    discardMarker(storage, orderId);
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    discardMarker(storage, orderId);
    return null;
  }
  const candidate = parsed as { orderId?: unknown; createdAt?: unknown };
  if (
    candidate.orderId !== orderId ||
    typeof candidate.createdAt !== 'number' ||
    !Number.isFinite(candidate.createdAt)
  ) {
    discardMarker(storage, orderId);
    return null;
  }
  if (now - candidate.createdAt > OXYGEN_HANDOFF_MARKER_TTL_MS) {
    discardMarker(storage, orderId);
    return null;
  }
  return { orderId, createdAt: candidate.createdAt };
}

export function clearOxygenHandoffMarker(
  storage: OxygenMarkerStorage | null,
  orderId: string
): void {
  if (storage === null || orderId === '') return;
  discardMarker(storage, orderId);
}

// Sign-out path: removes every handoff key, whatever order it belongs to.
export function clearAllOxygenHandoffMarkers(
  storage: OxygenMarkerStorage | null
): void {
  if (storage === null) return;
  let length = 0;
  try {
    length = storage.length;
  } catch {
    return;
  }
  if (typeof length !== 'number' || !Number.isFinite(length) || length < 0) {
    return;
  }
  const doomed: string[] = [];
  for (let i = 0; i < length; i += 1) {
    try {
      const key = storage.key(i);
      if (
        typeof key === 'string' &&
        key.startsWith(OXYGEN_HANDOFF_MARKER_PREFIX)
      ) {
        doomed.push(key);
      }
    } catch {
      // Skip unreadable slots; the sweep stays best-effort.
    }
  }
  for (const key of doomed) {
    try {
      storage.removeItem(key);
    } catch {
      // Best-effort: one locked key must not stop the sweep.
    }
  }
}
