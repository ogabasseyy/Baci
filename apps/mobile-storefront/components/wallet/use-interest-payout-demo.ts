import { useState } from 'react';
import { hostedStorefrontRuntime } from '@/lib/hosted-storefront-runtime';
import type { deriveWalletDisplayData } from './derive-wallet-display-data';

type Display = ReturnType<typeof deriveWalletDisplayData>;

export function useInterestPayoutDemo(
  ownerId: string | undefined,
  display: Display | undefined
) {
  const [receipt, setReceipt] = useState<{
    ownerId: string;
    goalId: string;
  } | null>(null);
  let enabled = false;
  try {
    enabled =
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      hostedStorefrontRuntime.read() !== null;
  } catch {
    enabled = false;
  }
  const goal = display?.activeSavingsGoal;
  const active = Boolean(
    enabled &&
      ownerId &&
      goal &&
      receipt?.ownerId === ownerId &&
      receipt.goalId === goal.id
  );
  const add = (amount: number) => Math.round((amount + 7.33) * 100) / 100;
  return {
    active,
    simulate: () => {
      if (enabled && ownerId && goal?.status === 'active')
        setReceipt({ ownerId, goalId: goal.id });
    },
    reset: () => setReceipt(null),
    display:
      active && display && goal
        ? {
            ...display,
            activeSavingsGoal: {
              ...goal,
              current_amount: add(goal.current_amount),
            },
            earningsAvailable: true,
            earningsBalance: add(display.earningsBalance ?? 0),
            savingsBalance: add(display.savingsBalance),
            totalBalance: add(display.totalBalance),
          }
        : display,
  };
}
