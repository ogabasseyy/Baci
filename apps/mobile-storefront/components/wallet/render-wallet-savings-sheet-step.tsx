import type { ReactNode } from 'react';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { SavingsVariantResolveResult } from './resolve-completed-savings-goal-variant';
import { SavingsPhoneSwapStep } from './savings/SavingsPhoneSwapStep';
import { SavingsVariantPickStep } from './savings/SavingsVariantPickStep';
import type { useSavingsDeviceSwap } from './use-savings-device-swap';

/**
 * The step the savings sheet shows instead of its main view: choosing the
 * exact phone of a completed goal, or changing the phone of an active one.
 * Returns null (not an empty element) when neither is open, because the
 * sheet shows its main view only when it gets no step.
 */
export function renderWalletSavingsSheetStep({
  colors,
  goal,
  showVariantPick,
  onCloseVariantPick,
  onResolveVariant,
  swap,
}: {
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal | null;
  showVariantPick: boolean;
  onCloseVariantPick: () => void;
  onResolveVariant: (variantId: string) => Promise<SavingsVariantResolveResult>;
  swap: ReturnType<typeof useSavingsDeviceSwap>;
}): ReactNode {
  if (!goal) return null;
  if (
    showVariantPick &&
    goal.status === 'completed' &&
    goal.selection_unresolved === true
  )
    return (
      <SavingsVariantPickStep
        colors={colors}
        goal={goal}
        onBack={onCloseVariantPick}
        onResolve={onResolveVariant}
        options={goal.variant_resolution_options ?? []}
      />
    );
  if (swap.showSavingsDeviceSwap)
    return <SavingsPhoneSwapStep colors={colors} goal={goal} swap={swap} />;
  return null;
}
