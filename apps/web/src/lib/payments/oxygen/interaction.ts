// Framework-agnostic core for the Oxygen checkout/chat interaction shell.
//
// Pure machine + per-status mapping + handoff-marker ops + hygiene builders.
// No imports, no I/O, no clock reads, no logging: the hook injects lookup,
// submit, storage, clock, and nonce; the panel renders snapshots. Display
// never authorizes — every action revalidates against the server, and the
// POST route re-checks before any handoff. Availability wording only (D-05):
// starting an application is never described as a credit decision.

export type OxygenInteractionState =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'unavailable'
  | 'signin-required'
  | 'initiating'
  | 'handed-off'
  | 'resuming'
  | 'failed';

// Mirrors the S-03 reason taxonomy (availability.ts). Copied, not imported,
// so this module stays dependency-free per the initiation.ts precedent.
export type OxygenInteractionReason =
  | 'oxygen_identity_mismatch'
  | 'oxygen_environment_mismatch'
  | 'oxygen_guest_not_allowed'
  | 'oxygen_not_configured'
  | 'oxygen_rollout_disabled'
  | 'oxygen_provider_unverified';

export type OxygenInteractionSessionStatus =
  | 'loading'
  | 'authenticated'
  | 'guest';

export type OxygenFailedRecovery = 'recheck' | 'resubmit';

export type OxygenInteractionAction =
  | 'signin'
  | 'recheck'
  | 'submit'
  | 'dismiss';

export interface OxygenInteractionSnapshot {
  state: OxygenInteractionState;
  reason?: OxygenInteractionReason;
  recoveries: OxygenFailedRecovery[];
}

// Normalized view of the real S-05 route responses. The future HTTP adapter
// translates status/body into these; network and parse failures reject, and
// the hook maps rejections to the network transitions below.
export type OxygenLookupResult =
  | { ok: true; available: boolean; reason?: string }
  | { ok: false; status: number; code?: string };

export type OxygenSubmitResult =
  | { ok: true }
  | { ok: false; status: number; code?: string };

export interface OxygenSubmitInput {
  orderId: string;
  nonce: string;
}

export type OxygenInteractionLookup = (
  orderId: string
) => Promise<OxygenLookupResult>;

export type OxygenInteractionSubmit = (
  input: OxygenSubmitInput
) => Promise<OxygenSubmitResult>;

// Structural subset of the tab-scoped web store. The core never touches a
// DOM singleton: the hook passes the live store or null, tests inject fakes.
export interface OxygenMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export interface OxygenHandoffMarker {
  orderId: string;
  createdAt: number;
}

// Client-generated handoff payload. POST 2xx bodies are never read — no
// server ids are echoed or fabricated in this slice.
export interface OxygenHandoffPayload {
  orderId: string;
  nonce: string;
  issuedAt: number;
}

export interface OxygenInteractionAnalyticsEvent {
  event: 'oxygen_interaction';
  properties: {
    status: OxygenInteractionState;
    reason?: OxygenInteractionReason;
  };
}

export const OXYGEN_INTERACTION_STATE_LIST: readonly OxygenInteractionState[] =
  [
    'idle',
    'checking',
    'ready',
    'unavailable',
    'signin-required',
    'initiating',
    'handed-off',
    'resuming',
    'failed',
  ];

export const OXYGEN_INTERACTION_REASON_LIST: readonly OxygenInteractionReason[] =
  [
    'oxygen_identity_mismatch',
    'oxygen_environment_mismatch',
    'oxygen_guest_not_allowed',
    'oxygen_not_configured',
    'oxygen_rollout_disabled',
    'oxygen_provider_unverified',
  ];

const INTERACTION_STATES: ReadonlySet<string> = new Set(
  OXYGEN_INTERACTION_STATE_LIST
);
const INTERACTION_REASONS: ReadonlySet<string> = new Set(
  OXYGEN_INTERACTION_REASON_LIST
);

export function isOxygenInteractionState(
  value: unknown
): value is OxygenInteractionState {
  return typeof value === 'string' && INTERACTION_STATES.has(value);
}

export function isOxygenInteractionReason(
  value: unknown
): value is OxygenInteractionReason {
  return typeof value === 'string' && INTERACTION_REASONS.has(value);
}

export function idleInteractionSnapshot(): OxygenInteractionSnapshot {
  return { state: 'idle', recoveries: [] };
}

// Uniform revalidate rule: a marker for the current order resumes, otherwise
// the shell checks from scratch.
export function snapshotForRevalidate(
  hasMarker: boolean
): OxygenInteractionSnapshot {
  return {
    state: hasMarker ? 'resuming' : 'checking',
    recoveries: [],
  };
}

// S-04 §403 message table, copied verbatim. The strings are the specified
// API, pinned against literals in the colocated tests.
export const OXYGEN_INTERACTION_REASON_COPY: Record<
  OxygenInteractionReason,
  string
> = {
  oxygen_identity_mismatch: 'This order cannot use Oxygen.',
  oxygen_environment_mismatch: 'Oxygen is not available here.',
  oxygen_guest_not_allowed: 'Sign in to continue with Oxygen.',
  oxygen_not_configured: 'Oxygen is not available for this store.',
  oxygen_rollout_disabled: 'Oxygen is not available right now.',
  oxygen_provider_unverified: 'Oxygen is not available for this store.',
};

export const OXYGEN_INTERACTION_FALLBACK_COPY = 'Something went wrong.';

export function getOxygenInteractionCopy(
  state: OxygenInteractionState,
  reason?: OxygenInteractionReason
): string {
  if (reason !== undefined && isOxygenInteractionReason(reason)) {
    return OXYGEN_INTERACTION_REASON_COPY[reason];
  }
  switch (state) {
    case 'checking':
      return 'Checking Oxygen availability…';
    case 'resuming':
      return 'Continue where you left off with Oxygen…';
    case 'ready':
      return 'Oxygen is available for this order.';
    case 'signin-required':
      return OXYGEN_INTERACTION_REASON_COPY.oxygen_guest_not_allowed;
    case 'initiating':
      return 'Starting Oxygen… Do not close this window.';
    case 'handed-off':
      return 'Continue with Oxygen in the secure form.';
    default:
      return OXYGEN_INTERACTION_FALLBACK_COPY;
  }
}

export const OXYGEN_INTERACTION_ACTION_LABELS: Record<
  OxygenInteractionAction,
  string
> = {
  signin: 'Sign in',
  recheck: 'Check again',
  submit: 'Continue with Oxygen',
  dismiss: 'Dismiss',
};

// Per-state action table. Busy and hidden states offer nothing; failed
// offers exactly the recoveries its cause recorded, then dismiss.
export function getOxygenInteractionActions(
  snapshot: OxygenInteractionSnapshot
): OxygenInteractionAction[] {
  switch (snapshot.state) {
    case 'ready':
      return ['submit', 'dismiss'];
    case 'unavailable':
      return ['recheck', 'dismiss'];
    case 'signin-required':
      return ['signin', 'dismiss'];
    case 'handed-off':
      return ['dismiss'];
    case 'failed': {
      const recoveries = Array.isArray(snapshot.recoveries)
        ? snapshot.recoveries
        : [];
      const offered = new Set<string>(recoveries);
      const actions: OxygenInteractionAction[] = [];
      if (offered.has('recheck')) actions.push('recheck');
      if (offered.has('resubmit')) actions.push('submit');
      actions.push('dismiss');
      return actions;
    }
    default:
      return [];
  }
}

export type OxygenLookupFromState = 'checking' | 'resuming';

export interface OxygenLookupTransition {
  snapshot: OxygenInteractionSnapshot;
  clearOrderMarker: boolean;
  logHostError: boolean;
}

function failedLookupTransition(
  recoveries: OxygenFailedRecovery[],
  clearOrderMarker: boolean,
  logHostError: boolean
): OxygenLookupTransition {
  return {
    snapshot: { state: 'failed', recoveries },
    clearOrderMarker,
    logHostError,
  };
}

// Lookup matrix shared by checking and resuming. The server's view wins: a
// guest deny routes to signin-required whatever the local session claims.
// Unknown deny reasons are contract skew and fail closed to a retryable
// failure, so unavailable always carries a taxonomy reason.
export function mapOxygenLookupResult(
  result: OxygenLookupResult,
  from: OxygenLookupFromState
): OxygenLookupTransition {
  if (result.ok) {
    if (result.available === true) {
      return {
        snapshot: { state: 'ready', recoveries: [] },
        clearOrderMarker: from === 'resuming',
        logHostError: false,
      };
    }
    const reason =
      typeof result.reason === 'string' ? result.reason : undefined;
    if (reason !== undefined && isOxygenInteractionReason(reason)) {
      if (reason === 'oxygen_guest_not_allowed') {
        return {
          snapshot: {
            state: 'signin-required',
            reason,
            recoveries: [],
          },
          clearOrderMarker: false,
          logHostError: false,
        };
      }
      return {
        snapshot: { state: 'unavailable', reason, recoveries: [] },
        clearOrderMarker: false,
        logHostError: false,
      };
    }
    return failedLookupTransition(['recheck'], false, false);
  }
  if (result.status === 404) {
    return {
      snapshot: idleInteractionSnapshot(),
      clearOrderMarker: true,
      logHostError: false,
    };
  }
  if (result.status === 401) {
    return {
      snapshot: { state: 'signin-required', recoveries: [] },
      clearOrderMarker: false,
      logHostError: false,
    };
  }
  if (result.status === 400) {
    return failedLookupTransition([], false, true);
  }
  return failedLookupTransition(['recheck'], false, false);
}

// Transients never discard: the marker survives for the recheck path.
export function mapOxygenLookupNetworkFailure(
  _from: OxygenLookupFromState
): OxygenLookupTransition {
  return failedLookupTransition(['recheck'], false, false);
}

export interface OxygenSubmitTransition {
  snapshot: OxygenInteractionSnapshot;
  clearOrderMarker: boolean;
  logHostError: boolean;
  handoff: boolean;
}

function failedSubmitTransition(
  recoveries: OxygenFailedRecovery[],
  clearOrderMarker: boolean,
  logHostError: boolean
): OxygenSubmitTransition {
  return {
    snapshot: { state: 'failed', recoveries },
    clearOrderMarker,
    logHostError,
    handoff: false,
  };
}

// Submit matrix. A coded 403 routes to unavailable; a codeless 403 is the
// CSRF shape and must never route there. Unknown codes fail closed to a
// retryable failure for the same reason as unknown lookup reasons.
export function mapOxygenSubmitResult(
  result: OxygenSubmitResult
): OxygenSubmitTransition {
  if (result.ok) {
    return {
      snapshot: { state: 'handed-off', recoveries: [] },
      clearOrderMarker: false,
      logHostError: false,
      handoff: true,
    };
  }
  if (result.status === 403) {
    const code =
      typeof result.code === 'string' && result.code !== ''
        ? result.code
        : undefined;
    if (code !== undefined && isOxygenInteractionReason(code)) {
      return {
        snapshot: { state: 'unavailable', reason: code, recoveries: [] },
        clearOrderMarker: false,
        logHostError: false,
        handoff: false,
      };
    }
    return failedSubmitTransition(['recheck', 'resubmit'], false, false);
  }
  if (result.status === 404) {
    return {
      snapshot: idleInteractionSnapshot(),
      clearOrderMarker: true,
      logHostError: false,
      handoff: false,
    };
  }
  if (result.status === 401) {
    return {
      snapshot: { state: 'signin-required', recoveries: [] },
      clearOrderMarker: false,
      logHostError: false,
      handoff: false,
    };
  }
  if (result.status === 400) {
    return failedSubmitTransition([], false, true);
  }
  return failedSubmitTransition(['recheck', 'resubmit'], false, false);
}

export function mapOxygenSubmitNetworkFailure(): OxygenSubmitTransition {
  return failedSubmitTransition(['recheck', 'resubmit'], false, false);
}

export interface OxygenDismissTransition {
  snapshot: OxygenInteractionSnapshot;
  clearOrderMarker: boolean;
  ignored: boolean;
}

// Dismiss is accepted everywhere except initiating (the do-not-close
// window) and idle (nothing to leave; markers stay).
export function applyOxygenDismiss(
  snapshot: OxygenInteractionSnapshot
): OxygenDismissTransition {
  if (snapshot.state === 'initiating' || snapshot.state === 'idle') {
    return { snapshot, clearOrderMarker: false, ignored: true };
  }
  return {
    snapshot: idleInteractionSnapshot(),
    clearOrderMarker: true,
    ignored: false,
  };
}

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

// Default nonce source. Engines (Node 24 + supported browsers) guarantee
// randomUUID, so there is deliberately no fallback.
export function generateOxygenNonce(): string {
  return crypto.randomUUID();
}

// Chat hygiene builder for the future chat adapter. Unknown inputs fall back
// to a safe generic; the input itself is never echoed.
export function toChatMessageText(input: {
  status: unknown;
  reason?: unknown;
}): string {
  if (!isOxygenInteractionState(input.status)) {
    return OXYGEN_INTERACTION_FALLBACK_COPY;
  }
  if (input.reason !== undefined && !isOxygenInteractionReason(input.reason)) {
    return OXYGEN_INTERACTION_FALLBACK_COPY;
  }
  return getOxygenInteractionCopy(input.status, input.reason);
}

// Analytics hygiene builder. Unknown statuses null out (the host skips);
// unknown reasons are dropped while the valid status still reports. Output
// matches the client event sink shape: event plus properties.
export function toAnalyticsEvent(input: {
  status: unknown;
  reason?: unknown;
}): OxygenInteractionAnalyticsEvent | null {
  if (!isOxygenInteractionState(input.status)) {
    return null;
  }
  if (input.reason !== undefined && isOxygenInteractionReason(input.reason)) {
    return {
      event: 'oxygen_interaction',
      properties: { status: input.status, reason: input.reason },
    };
  }
  return {
    event: 'oxygen_interaction',
    properties: { status: input.status },
  };
}
