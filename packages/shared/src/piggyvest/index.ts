/**
 * Centralized PiggyVest plan-wallet savings policy (one focused module per
 * decision, re-exported here so web and mobile can never drift on
 * activation, pricing, or maturity).
 *
 * Pure, versioned decisions: snapshot variant, price, quote expiry, and
 * terms version server-side before calling these; they decide only from
 * confirmed amounts, never from pending accrual or client claims.
 */

export { activationThresholdKobo } from './activation-threshold-kobo';
export { applicablePriceKobo } from './applicable-price-kobo';
export { isActivated } from './plan-activation';
export type { PlanMaturityStatus } from './plan-maturity-status';
export { maturityStatus } from './plan-maturity-status';
export { addCalendarMonthsClamped } from './add-calendar-months-clamped';
export { isReady } from './plan-readiness';
export { purchasingPowerKobo } from './purchasing-power-kobo';
export {
  ACTIVATION_RATIO_DENOMINATOR,
  ACTIVATION_RATIO_NUMERATOR,
  GRACE_PERIOD_DAYS,
  MAX_DURATION_MONTHS,
  SAVINGS_POLICY_VERSION,
} from './savings-policy-constants';
