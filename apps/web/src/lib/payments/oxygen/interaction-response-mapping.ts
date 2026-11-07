import {
  idleInteractionSnapshot,
  isOxygenInteractionReason,
} from './interaction-presentation';
import type {
  OxygenFailedRecovery,
  OxygenInteractionSnapshot,
  OxygenLookupResult,
  OxygenSubmitResult,
} from './interaction-types';

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
