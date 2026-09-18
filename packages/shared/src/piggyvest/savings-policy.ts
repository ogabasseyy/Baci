/**
 * Pure, versioned savings-policy decisions for the PiggyVest plan wallet.
 *
 * Policy version: 1. Snapshot variant, price, quote expiry, and terms
 * version server-side before calling these; they decide only from
 * confirmed amounts, never from pending accrual or client claims.
 * Pure math only: no provider calls, no storage, no network.
 *
 * Timezone note: maturity uses calendar months in Africa/Lagos with
 * month-end clamping, derived from the supplied instant — callers may pass
 * any instant (UTC or offset) and the Lagos calendar date governs.
 * Grace is 30 calendar days. Past grace retains funds and reports
 * review-required; there is no automatic refund or forfeiture.
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

const LAGOS_TIME_ZONE = 'Africa/Lagos';

// Single formatter for every Lagos calendar field, mirroring the
// `formatToParts` precedent in customer-savings-auto-debit-schedule.
const LAGOS_DATE_TIME_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  'en-GB',
  {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric',
  }
);

interface LagosDateTime {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

function lagosDateTime(date: Date): LagosDateTime {
  assertValidDate(date, 'date');
  const values: Record<string, string> = {};
  for (const part of LAGOS_DATE_TIME_FORMAT.formatToParts(date)) {
    values[part.type] = part.value;
  }
  // Some ICU builds render midnight as "24" with hour12: false.
  const hour = Number(values.hour) % 24;
  return {
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year: Number(values.year),
  };
}

/**
 * Convert Lagos wall-clock fields back to the UTC instant that displays as
 * them. Lagos (WAT) carries no DST transitions, so a single offset probe is
 * exact; milliseconds are preserved from the source instant.
 */
function lagosWallTimeToUtc(parts: LagosDateTime, millisecond: number): Date {
  const wallAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond
  );
  const probe = lagosDateTime(new Date(wallAsUtcMs));
  const probeWallAsUtcMs = Date.UTC(
    probe.year,
    probe.month - 1,
    probe.day,
    probe.hour,
    probe.minute,
    probe.second
  );
  // Whole-second comparison: the probe drops sub-second precision.
  const offsetMs = probeWallAsUtcMs - Math.floor(wallAsUtcMs / 1000) * 1000;
  return new Date(wallAsUtcMs - offsetMs);
}

export function addCalendarMonthsClamped(date: Date, months: number): Date {
  const origin = lagosDateTime(date);
  const targetMonthIndex = origin.month - 1 + months;
  const targetYear = origin.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(origin.day, lastDay);
  return lagosWallTimeToUtc(
    {
      day: clampedDay,
      hour: origin.hour,
      minute: origin.minute,
      month: normalizedMonth + 1,
      second: origin.second,
      year: targetYear,
    },
    date.getMilliseconds()
  );
}

function addCalendarDays(date: Date, days: number): Date {
  assertValidDate(date, 'date');
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

function assertKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer kobo`);
  }
}
