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
