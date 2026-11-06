import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getContributionCap } from './get-contribution-cap';

export type QuickAmountOption = { amount: number; label: string };

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
    .map((amount) => ({ amount, label: formatNgnCurrency(amount) }));
  if (allAvailable > 0) {
    options.push({
      amount: allAvailable,
      label:
        Math.floor(available) <= remaining ? 'All available' : 'Reach goal',
    });
  }
  return options;
}
