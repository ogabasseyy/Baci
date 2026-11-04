import { idleInteractionSnapshot } from './interaction-presentation';
import type { OxygenInteractionSnapshot } from './interaction-types';

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
