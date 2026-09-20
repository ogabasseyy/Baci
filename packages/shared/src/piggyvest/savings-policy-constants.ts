/**
 * Versioned constants for the PiggyVest plan-wallet savings policy.
 *
 * Policy version: 1. Snapshot variant, price, quote expiry, and terms
 * version server-side before calling these; the policy modules decide only
 * from confirmed amounts, never from pending accrual or client claims.
 */

export const SAVINGS_POLICY_VERSION = 1;

export const ACTIVATION_RATIO_NUMERATOR = 5;
export const ACTIVATION_RATIO_DENOMINATOR = 100;
export const MAX_DURATION_MONTHS = 6;
export const GRACE_PERIOD_DAYS = 30;
