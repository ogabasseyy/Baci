import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

/** Presentation-only copy and arithmetic for the savings screens. */

type Encouragement = { body: string; title: string };

const MS_PER_DAY = 86_400_000;
const QUICK_AMOUNTS = [1000, 5000, 10000] as const;

/** Friendly line for how far along a goal is. Never promises a return. */
export function getSavingsEncouragement(percent: number): Encouragement {
  if (percent >= 100) {
    return {
      title: 'Goal reached!',
      body: 'You did it. Time to celebrate your savings.',
    };
  }
  if (percent >= 75) {
    return {
      title: 'Almost there!',
      body: 'The finish line is in sight. Keep going.',
    };
  }
  if (percent >= 50) {
    return {
      title: 'Halfway there!',
      body: "Look at you go. You're over the hump.",
    };
  }
  if (percent >= 25) {
    return {
      title: 'A quarter of the way!',
      body: 'Nice momentum. Every top-up gets you closer.',
    };
  }
  if (percent > 0) {
    return {
      title: 'Great start!',
      body: 'Small steps add up. Keep it going.',
    };
  }
  return {
    title: 'Every naira counts',
    body: 'Start with any amount.',
  };
}

function utcDayStart(value: string) {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!day) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

/**
 * "Save about ₦X a week" from the amount still needed and the goal's own
 * maturity date. Returns null when there is no usable future date or nothing
 * left to save, so the nudge is simply skipped.
 */
export function getWeeklySavingsNudge({
  maturityDate,
  now = new Date(),
  remaining,
}: {
  maturityDate: string | null | undefined;
  now?: Date;
  remaining: number;
}) {
  if (!maturityDate || !Number.isFinite(remaining) || remaining <= 0) {
    return null;
  }
  const end = utcDayStart(maturityDate);
  const today = utcDayStart(now.toISOString());
  if (end === null || today === null || end <= today) return null;
  const daysRemaining = (end - today) / MS_PER_DAY;
  const weeks = Math.max(1, Math.ceil(daysRemaining / 7));
  const amountPerWeek = Math.ceil(remaining / Math.max(1, daysRemaining / 7));
  return {
    amountPerWeek,
    label: `Save about ${formatNgnCurrency(amountPerWeek)} a week to reach this by ${formatDateTimeDisplay(maturityDate, 'date')}`,
    weeks,
  };
}

export type QuickAmountOption = { amount: number; label: string };

/** Suggest a modest amount; spending the full available balance is opt-in. */
export function getDefaultContributionAmount({
  available,
  remaining,
}: {
  available: number;
  remaining: number;
}) {
  return Math.min(QUICK_AMOUNTS[0], getContributionCap(available, remaining));
}

/**
 * Quick-pick chips: fixed amounts that fit in what is left, plus one chip for
 * the whole available balance (or the rest of the goal when the wallet holds
 * more than that). Every amount is within the remaining goal amount.
 */
export function getQuickAmountOptions({
  available,
  remaining,
}: {
  available: number;
  remaining: number;
}): QuickAmountOption[] {
  const allAvailable = getContributionCap(available, remaining);
  const options: QuickAmountOption[] = QUICK_AMOUNTS.filter(
    (amount) => amount <= remaining && amount !== allAvailable
  ).map((amount) => ({ amount, label: formatNgnCurrency(amount) }));
  if (allAvailable > 0) {
    options.push({
      amount: allAvailable,
      label:
        Math.floor(available) <= remaining ? 'All available' : 'Reach goal',
    });
  }
  return options;
}

function getContributionCap(available: number, remaining: number) {
  const cap = Math.floor(Math.min(available, remaining));
  return Number.isSafeInteger(cap) && cap > 0 ? cap : 0;
}
