// Pure S-03 verdict mappers: no authz params, no I/O, no imports.

export type OxygenDecisionReason =
  | 'oxygen_identity_mismatch'
  | 'oxygen_environment_mismatch'
  | 'oxygen_guest_not_allowed'
  | 'oxygen_not_configured'
  | 'oxygen_rollout_disabled'
  | 'oxygen_provider_unverified';

export type OxygenPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: OxygenDecisionReason };

// S-04 §403 message table. Code echoes the reason string.
const OXYGEN_DENY_MESSAGES: Record<OxygenDecisionReason, string> = {
  oxygen_identity_mismatch: 'This order cannot use Oxygen.',
  oxygen_environment_mismatch: 'Oxygen is not available here.',
  oxygen_guest_not_allowed: 'Sign in to continue with Oxygen.',
  oxygen_not_configured: 'Oxygen is not available for this store.',
  oxygen_rollout_disabled: 'Oxygen is not available right now.',
  oxygen_provider_unverified: 'Oxygen is not available for this store.',
};

export function mapInitiationDecision(decision: OxygenPolicyDecision): {
  status: 403 | 503;
  body: { error: string; code: string };
} {
  if (decision.allowed) {
    // Phase A: no execution stage exists, so even a policy allow cannot
    // proceed. Phase B replaces this arm with the atomic attempt operation.
    return {
      status: 503,
      body: {
        error: 'Oxygen provider unavailable',
        code: 'oxygen_provider_unavailable',
      },
    };
  }
  return {
    status: 403,
    body: {
      error: OXYGEN_DENY_MESSAGES[decision.reason],
      code: decision.reason,
    },
  };
}

export function mapAvailabilityDecision(decision: OxygenPolicyDecision): {
  status: 200;
  body: { available: boolean; reason?: OxygenDecisionReason };
} {
  if (decision.allowed) {
    return { status: 200, body: { available: true } };
  }
  return {
    status: 200,
    body: { available: false, reason: decision.reason },
  };
}
