import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getWeeklySavingsNudge } from './get-weekly-savings-nudge';

type Frequency = 'daily' | 'weekly' | 'monthly';

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

/** The phone's own calendar day (e.g. Lagos), as YYYY-MM-DD. */
function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Whole days from the customer's today to the end date; null if unusable. */
export function daysUntil(
  maturityDate: string | null | undefined,
  now: Date
): number | null {
  const end = /^\d{4}-\d{2}-\d{2}/.exec(maturityDate ?? '')?.[0];
  if (!end) return null;
  const days =
    (Date.parse(`${end}T00:00:00Z`) -
      Date.parse(`${localDay(now)}T00:00:00Z`)) /
    MS_PER_DAY;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/**
 * How many payments fit from today to the end date, today counting as one:
 * whole days for daily, whole weeks for weekly, calendar months for monthly.
 */
export function paymentsThatFit(
  frequency: Frequency,
  maturityDate: string | null | undefined,
  now: Date
): number {
  const days = daysUntil(maturityDate, now);
  if (days === null) return 0;
  if (frequency === 'daily') return days + 1;
  if (frequency === 'weekly') return Math.floor(days / 7) + 1;
  const [ey, em, ed] = (maturityDate ?? '').slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = localDay(now).split('-').map(Number);
  const months = (ey - ty) * 12 + (em - tm) - (ed < td ? 1 : 0);
  return Math.max(0, months) + 1;
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
    const fits = paymentsThatFit(frequency as Frequency, maturityDate, now);
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
