import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getContributionCap } from './get-contribution-cap';

export type QuickAmountOption = {
  amount: number;
  label: string;
  /** What a screen reader says when the short label is not enough. */
  spokenLabel?: string;
};

/** Fixed quick-picks plus one opt-in option for all available funds. */
export function getQuickAmountOptions({
  available,
  remaining,
}: {
  available: number;
  remaining: number;
}): QuickAmountOption[] {
  const allAvailable = getContributionCap(available, remaining);
  const options: QuickAmountOption[] = [1000, 5000, 10000]
    .filter((amount) => amount <= remaining && amount !== allAvailable)
    .map((amount) => ({ amount, label: `₦${amount / 1000}k` }));
  if (allAvailable > 0) {
    options.push({
      amount: allAvailable,
      // Short labels keep all four chips on one row.
      ...(available <= remaining
        ? { label: 'Max', spokenLabel: 'all available' }
        : allAvailable === remaining
          ? { label: 'Finish', spokenLabel: 'reach goal' }
          : { label: formatNgnCurrency(allAvailable) }),
    });
  }
  return options;
}
