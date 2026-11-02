import type {
  OxygenInteractionAction,
  OxygenInteractionReason,
  OxygenInteractionSnapshot,
  OxygenInteractionState,
} from './interaction-types';

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
