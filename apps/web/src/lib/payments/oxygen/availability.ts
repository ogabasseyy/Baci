export type OxygenAvailabilityReason =
  | 'oxygen_identity_mismatch'
  | 'oxygen_environment_mismatch'
  | 'oxygen_guest_not_allowed'
  | 'oxygen_not_configured'
  | 'oxygen_rollout_disabled'
  | 'oxygen_provider_unverified';

export interface OxygenAvailabilityInput {
  merchant: { id: string };
  customer: { id: string } | null;
  order: { id: string; merchantId: string };
  environment: string;
  expectedEnvironment: string;
  policy: { guestInitiationsAllowed: boolean };
  rollout: { newInitiationsEnabled: boolean } | null;
  providerReadiness: { verified: boolean } | null;
}

export type OxygenAvailabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: OxygenAvailabilityReason };

export interface OxygenRecoveryInput {
  merchant: { id: string };
  attempt: { id: string; merchantId: string; environment: string };
  environment: string;
  expectedEnvironment: string;
}

export type OxygenRecoveryDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'oxygen_identity_mismatch' | 'oxygen_environment_mismatch';
    };

/**
 * Server-owned availability policy for Oxygen initiation.
 *
 * Local availability means permission to START an application — never credit
 * approval. Callers MUST resolve every input from trusted sources: the
 * merchant via the authorized merchant context, the customer via the
 * authenticated session (null for guests), the order from its locked row
 * (never the request body), and rollout/readiness/policy from server-owned
 * configuration. No readiness resolver exists until CR-14 closes, so
 * production denies at `oxygen_provider_unverified` today.
 *
 * Pure and synchronous: no imports, no I/O, no clock, no logging. Decisions
 * echo no identities.
 */
export function decideOxygenNewInitiation(
  input: OxygenAvailabilityInput
): OxygenAvailabilityDecision {
  // 1. Binding integrity first: caller bugs surface before readiness state.
  if (
    !isNonBlankString(input.merchant?.id) ||
    !isNonBlankString(input.order?.id) ||
    input.order?.merchantId !== input.merchant?.id ||
    (input.customer !== null &&
      !isNonBlankString((input.customer as { id?: unknown })?.id))
  ) {
    return { allowed: false, reason: 'oxygen_identity_mismatch' };
  }
  // 2. Exact environment match; empty fails closed.
  if (
    !isNonBlankString(input.environment) ||
    input.environment !== input.expectedEnvironment
  ) {
    return { allowed: false, reason: 'oxygen_environment_mismatch' };
  }
  // 3. Guest policy is injected, not decided here: the future composition
  // root passes `false` until the product decision lands.
  if (
    input.customer === null &&
    input.policy?.guestInitiationsAllowed !== true
  ) {
    return { allowed: false, reason: 'oxygen_guest_not_allowed' };
  }
  // 4-5. Readiness, most-absent first. Strict `=== true`: truthy
  // non-booleans deny rather than affirm.
  if (typeof input.rollout !== 'object' || input.rollout === null) {
    return { allowed: false, reason: 'oxygen_not_configured' };
  }
  if (input.rollout.newInitiationsEnabled !== true) {
    return { allowed: false, reason: 'oxygen_rollout_disabled' };
  }
  if (
    typeof input.providerReadiness !== 'object' ||
    input.providerReadiness === null
  ) {
    return { allowed: false, reason: 'oxygen_not_configured' };
  }
  if (input.providerReadiness.verified !== true) {
    return { allowed: false, reason: 'oxygen_provider_unverified' };
  }
  return { allowed: true };
}

/**
 * Recovery continuity is structurally independent of the initiation kill
 * switch: this decision takes no rollout/readiness inputs, so disabling new
 * initiations cannot block it. Binding-only — attempt existence and caller
 * authority need the future DB-backed consumer.
 */
export function decideOxygenRecovery(
  input: OxygenRecoveryInput
): OxygenRecoveryDecision {
  if (
    !isNonBlankString(input.merchant?.id) ||
    !isNonBlankString(input.attempt?.id) ||
    input.attempt?.merchantId !== input.merchant?.id
  ) {
    return { allowed: false, reason: 'oxygen_identity_mismatch' };
  }
  if (
    !isNonBlankString(input.environment) ||
    input.environment !== input.expectedEnvironment ||
    input.attempt?.environment !== input.environment
  ) {
    return { allowed: false, reason: 'oxygen_environment_mismatch' };
  }
  return { allowed: true };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
