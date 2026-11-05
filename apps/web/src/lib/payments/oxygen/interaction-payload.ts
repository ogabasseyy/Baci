import {
  getOxygenInteractionCopy,
  isOxygenInteractionReason,
  isOxygenInteractionState,
  OXYGEN_INTERACTION_FALLBACK_COPY,
} from './interaction-presentation';
import type { OxygenInteractionAnalyticsEvent } from './interaction-types';

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
