import type { SavingsFrequency } from './start-savings.helpers';

export function formatSavingsDuration(
  target: number,
  contribution: number,
  frequency: SavingsFrequency
): string {
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(contribution) ||
    target <= 0 ||
    contribution <= 0
  ) {
    return '—';
  }
  const periods = Math.ceil(target / contribution) - 1;
  if (periods === 0) return 'Same day';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[frequency];
  return `${periods} ${unit}${periods === 1 ? '' : 's'}`;
}
