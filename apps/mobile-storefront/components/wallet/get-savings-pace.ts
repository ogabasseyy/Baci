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
    // Never ask for more than is left to save.
    const amount = formatNgnCurrency(
      Math.min(contributionAmount, Math.ceil(remaining))
    );
    const weekly = getWeeklySavingsNudge({ maturityDate, now, remaining });
    // Only show the end date when this pace can still reach it: a plan that
    // is behind shows its pace alone rather than a date it cannot meet.
    const payments = Math.ceil(remaining / contributionAmount);
    const reachable =
      weekly !== null &&
      payments <=
        Math.floor((weekly.weeks * 7) / PERIOD_DAYS[frequency as Frequency]) +
          1;
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
