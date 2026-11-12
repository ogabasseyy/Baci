import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getWeeklySavingsNudge } from './get-weekly-savings-nudge';

type Frequency = 'daily' | 'weekly' | 'monthly';

const PERIOD_DAYS: Record<Frequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

const PER: Record<Frequency, string> = {
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
};

export type SavingsPace = {
  /** Short line for the card, e.g. "₦2,000 a day · until 29 Dec 2026". */
  short: string;
  /** Full sentence for screen readers and the progress card. */
  label: string;
};

const MS_PER_DAY = 86_400_000;

/** Whole days from today (UTC) to the end date; null when unusable. */
export function daysUntil(
  maturityDate: string | null | undefined,
  now: Date
): number | null {
  const end = /^\d{4}-\d{2}-\d{2}/.exec(maturityDate ?? '')?.[0];
  const today = now.toISOString().slice(0, 10);
  if (!end) return null;
  const days =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
    MS_PER_DAY;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/**
 * The pace shown on a savings plan. It is the plan's own contribution and
 * frequency (what the customer chose), never a recalculated weekly figure,
 * so the wallet matches the plan. A plan without a usable contribution falls
 * back to the weekly pace worked out from its end date.
 */
export function getSavingsPace({
  contributionAmount,
  frequency,
  maturityDate,
  now = new Date(),
  remaining,
}: {
  contributionAmount: number | null | undefined;
  frequency: Frequency | null | undefined;
  maturityDate: string | null | undefined;
  now?: Date;
  remaining: number;
}): SavingsPace | null {
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const per = frequency ? PER[frequency] : undefined;
  if (
    per &&
    typeof contributionAmount === 'number' &&
    Number.isFinite(contributionAmount) &&
    contributionAmount > 0
  ) {
    // Always the plan's own pace (the last payment may simply be smaller).
    const amount = formatNgnCurrency(contributionAmount);
    const weekly = getWeeklySavingsNudge({ maturityDate, now, remaining });
    // Only show the end date when this pace can still reach it: a plan that
    // is behind shows its pace alone rather than a date it cannot meet.
    const payments = Math.ceil(remaining / contributionAmount);
    const days = daysUntil(maturityDate, now);
    // Payments that fit: one today plus one each full period up to the end
    // date (exact days, not whole weeks rounded up).
    const fits =
      days === null
        ? 0
        : Math.floor(days / PERIOD_DAYS[frequency as Frequency]) + 1;
    const reachable = weekly !== null && payments <= fits;
    if (!weekly || !reachable)
      return { short: `${amount} ${per}`, label: `${amount} ${per}` };
    return {
      short: `${amount} ${per} · until ${weekly.endsOn}`,
      // The plan's own pace and end date, not a promise: a plan that is
      // behind needs more. One formatted date for line and spoken label.
      label: `${amount} ${per} until ${weekly.endsOn}`,
    };
  }
  const weekly = getWeeklySavingsNudge({ maturityDate, now, remaining });
  if (!weekly) return null;
  return {
    short: `${formatNgnCurrency(weekly.amountPerWeek)} ${weekly.due ? 'due' : 'a week'} · ${weekly.due ? 'by' : 'until'} ${weekly.endsOn}`,
    label: weekly.label,
  };
}
