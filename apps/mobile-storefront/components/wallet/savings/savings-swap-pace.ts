import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

const DAYS: Record<WalletActiveSavingsGoal['contribution_frequency'], number> =
  {
    daily: 1,
    weekly: 7,
    monthly: 365.25 / 12,
  };

const UNIT: Record<WalletActiveSavingsGoal['contribution_frequency'], string> =
  {
    daily: 'a day',
    weekly: 'a week',
    monthly: 'a month',
  };

/**
 * What the plan needs per contribution period to reach `remaining` by its
 * end date, in the plan's own frequency (a monthly plan is never quoted
 * weekly). Null when there is no end date in the future or nothing left.
 */
export function savingsSwapPace({
  frequency,
  maturityDate,
  now = new Date(),
  remaining,
}: {
  frequency: WalletActiveSavingsGoal['contribution_frequency'];
  maturityDate: string | null | undefined;
  now?: Date;
  remaining: number;
}): { amount: number; unit: string } | null {
  const endDay = /^\d{4}-\d{2}-\d{2}/.exec(maturityDate ?? '')?.[0];
  if (!endDay || !Number.isFinite(remaining) || remaining <= 0) return null;
  const end = Date.parse(`${endDay}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || end <= today) return null;
  const periods = Math.max(1, (end - today) / 86_400_000 / DAYS[frequency]);
  return { amount: Math.ceil(remaining / periods), unit: UNIT[frequency] };
}
