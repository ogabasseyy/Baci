/**
 * Pure, versioned savings-policy decisions for the plan-wallet staging preview.
 *
 * Mobile mirror of `apps/web/src/lib/piggyvest/savings-policy.ts` (policy
 * version 1). Keep both in lockstep; the web copy is authoritative.
 * Pure math only: no provider calls, no storage, no network.
 *
 * All money fields are integer kobo. Pending interest is never spendable.
 */

export const SAVINGS_POLICY_VERSION = 1;

export const ACTIVATION_RATIO_NUMERATOR = 5;
export const ACTIVATION_RATIO_DENOMINATOR = 100;
export const MAX_DURATION_MONTHS = 6;
export const GRACE_PERIOD_DAYS = 30;

export type PlanMaturityStatus = 'active' | 'grace' | 'review-required';

export function purchasingPowerKobo(
  principalKobo: number,
  paidInterestKobo: number
): number {
  assertKobo(principalKobo, 'principalKobo');
  assertKobo(paidInterestKobo, 'paidInterestKobo');
  return principalKobo + paidInterestKobo;
}

export function activationThresholdKobo(quotedPriceKobo: number): number {
  assertKobo(quotedPriceKobo, 'quotedPriceKobo');
  return Math.ceil(
    (quotedPriceKobo * ACTIVATION_RATIO_NUMERATOR) /
      ACTIVATION_RATIO_DENOMINATOR
  );
}

export function isActivated(
  confirmedContributionKobo: number,
  quotedPriceKobo: number
): boolean {
  assertKobo(confirmedContributionKobo, 'confirmedContributionKobo');
  return confirmedContributionKobo >= activationThresholdKobo(quotedPriceKobo);
}

export function applicablePriceKobo(args: {
  guaranteedPriceKobo: number;
  currentPriceKobo: number;
  protectedOfferPriceKobo?: number;
  protectedOfferExpiresAt?: Date;
  now?: Date;
}): number {
  assertKobo(args.guaranteedPriceKobo, 'guaranteedPriceKobo');
  assertKobo(args.currentPriceKobo, 'currentPriceKobo');
  const now = args.now ?? new Date();
  if (
    args.protectedOfferPriceKobo !== undefined &&
    args.protectedOfferExpiresAt !== undefined &&
    now <= args.protectedOfferExpiresAt
  ) {
    assertKobo(args.protectedOfferPriceKobo, 'protectedOfferPriceKobo');
    return args.protectedOfferPriceKobo;
  }
  return Math.min(args.guaranteedPriceKobo, args.currentPriceKobo);
}

export function isReady(
  spendableKobo: number,
  applicablePrice: number
): boolean {
  assertKobo(spendableKobo, 'spendableKobo');
  assertKobo(applicablePrice, 'applicablePrice');
  return spendableKobo >= applicablePrice;
}

export function maturityStatus(
  activatedAt: Date,
  now: Date = new Date()
): PlanMaturityStatus {
  const maturity = addCalendarMonthsClamped(activatedAt, MAX_DURATION_MONTHS);
  if (now < maturity) return 'active';
  const graceEnd = addCalendarDays(maturity, GRACE_PERIOD_DAYS);
  if (now < graceEnd) return 'grace';
  return 'review-required';
}

export function addCalendarMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = month + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0));
  const clampedDay = Math.min(day, lastDay.getUTCDate());
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function assertKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer kobo`);
  }
}
