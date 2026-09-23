/**
 * Plan maturity in calendar months in Africa/Lagos with month-end clamping,
 * derived from the supplied instant — callers may pass any instant (UTC or
 * offset) and the Lagos calendar date governs. Grace is 30 calendar days.
 * Past grace retains funds and reports review-required; there is no
 * automatic refund or forfeiture.
 */
import { addCalendarMonthsClamped } from './add-calendar-months-clamped';
import { assertValidDate } from './assert-valid-date';
import {
  GRACE_PERIOD_DAYS,
  MAX_DURATION_MONTHS,
} from './savings-policy-constants';

export type PlanMaturityStatus = 'active' | 'grace' | 'review-required';

export function maturityStatus(
  activatedAt: Date,
  now: Date = new Date()
): PlanMaturityStatus {
  // An invalid comparison instant must fail closed: every comparison below
  // is false for it, which would silently report review-required and move
  // an otherwise active or grace-period plan into manual review.
  assertValidDate(now, 'now');
  const maturity = addCalendarMonthsClamped(activatedAt, MAX_DURATION_MONTHS);
  if (now < maturity) return 'active';
  const graceEnd = addCalendarDays(maturity, GRACE_PERIOD_DAYS);
  if (now < graceEnd) return 'grace';
  return 'review-required';
}

function addCalendarDays(date: Date, days: number): Date {
  assertValidDate(date, 'date');
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
